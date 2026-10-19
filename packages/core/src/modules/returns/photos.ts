import { randomUUID } from 'node:crypto'
import { and, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Database, Transaction } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { returnPhotos, returnRequests } from '../../db/schema/index.ts'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  NotSignedInError,
  TooManyRequestsError,
  ValidationError,
} from '../../errors.ts'
import { MAX_UPLOAD_BYTES } from '../../lib/images.ts'
import { uniqueViolation } from '../../lib/postgres.ts'
import type { JobQueue, QueueDefinition } from '../../lib/queue.ts'
import type { ObjectStorage } from '../../lib/storage.ts'
import { isUuid, parseInput } from '../../lib/validation.ts'
import {
  MAX_WAITING_PHOTOS_PER_DAY,
  newReturnPhoto,
  returnPhotoIds,
  returnPhotoUploadRequest,
  type ReturnPhotoDownload,
  type ReturnPhotoStatus,
  type ReturnPhotoUpload,
  type ReturnPhotoView,
} from './types.ts'

/*
 * Buyers' return photos (design doc 5.7). The buyer's browser uploads each
 * photo straight to object storage with a signed form while the return form
 * is open; the worker checks it and keeps a re-encoded private copy
 * (jobs.ts); sending the return request attaches the ready photos to it.
 * The buyer, the seller of the returned item, and administrators open a
 * photo through a short-lived signed link.
 */

export const CHECK_RETURN_PHOTO_QUEUE = 'returns.check-photo'

export const returnQueues: QueueDefinition[] = [
  {
    name: CHECK_RETURN_PHOTO_QUEUE,
    options: {
      retryLimit: 3,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 300,
      deleteAfterSeconds: 7 * 24 * 60 * 60,
    },
  },
]

export const checkReturnPhotoJob = z.object({ photoId: z.uuid() })

const UPLOAD_FORM_SECONDS = 10 * 60
const DOWNLOAD_SECONDS = 5 * 60
const UPLOAD_KEY =
  /^uploads\/returns\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Where the worker keeps the checked copy; the bucket keeps it private. */
export const returnPhotoStorageKey = (photoId: string) => `returns/${photoId}`

const NOT_FOUND = 'There is no return photo with that id'
const INVALID = 'That photo cannot be added'

type Buyer = Extract<RequestContext, { role: 'buyer' }>
type PhotoRow = typeof returnPhotos.$inferSelect

const STATUSES: readonly ReturnPhotoStatus[] = ['processing', 'ready', 'failed']

function assertBuyer(context: RequestContext): asserts context is Buyer {
  if (context.role === 'anonymous') throw new NotSignedInError()
  if (context.role !== 'buyer') {
    throw new ForbiddenError('Only buyers can add return photos')
  }
}

function toView(row: PhotoRow): ReturnPhotoView {
  const status = STATUSES.find((value) => value === row.status)
  if (!status) throw new Error(`Unknown return photo status ${row.status}`)
  return {
    id: row.id,
    status,
    failureReason: row.failureReason,
    width: row.width,
    height: row.height,
    returnRequestId: row.returnRequestId,
    uploadedAt: row.createdAt,
  }
}

/** Failed photos and photos already sent with a return do not count. */
async function assertRoomForPhoto(tx: Transaction, userId: string) {
  const [{ count } = { count: 0 }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(returnPhotos)
    .where(
      and(
        eq(returnPhotos.userId, userId),
        isNull(returnPhotos.returnRequestId),
        ne(returnPhotos.status, 'failed'),
        gt(returnPhotos.createdAt, sql`now() - interval '1 day'`),
      ),
    )
  if (count >= MAX_WAITING_PHOTOS_PER_DAY) {
    throw new TooManyRequestsError(
      `You can upload at most ${MAX_WAITING_PHOTOS_PER_DAY} return photos a day; send your return with the photos you have`,
    )
  }
}

/**
 * Signs a form the buyer's browser uploads one photo with. The checks run in
 * a transaction first; signing happens outside it.
 */
export async function createReturnPhotoUpload(
  { db, storage }: { db: Database; storage: ObjectStorage },
  context: RequestContext,
  input: unknown,
): Promise<ReturnPhotoUpload> {
  assertBuyer(context)
  const request = parseInput(
    returnPhotoUploadRequest,
    input,
    'That photo cannot be uploaded',
  )
  await withContext(db, context, (tx) => assertRoomForPhoto(tx, context.userId))
  const key = `uploads/returns/${context.userId}/${randomUUID()}`
  const form = await storage.createUploadForm(key, {
    contentType: request.contentType,
    maxBytes: MAX_UPLOAD_BYTES,
    expiresInSeconds: UPLOAD_FORM_SECONDS,
  })
  return {
    key,
    ...form,
    maxBytes: MAX_UPLOAD_BYTES,
    expiresAt: new Date(Date.now() + UPLOAD_FORM_SECONDS * 1000),
  }
}

/**
 * Adds an uploaded photo as `processing` and queues the job that checks it,
 * in the same transaction.
 */
export async function addReturnPhoto(
  tx: Transaction,
  queue: JobQueue,
  context: RequestContext,
  input: unknown,
): Promise<ReturnPhotoView> {
  assertBuyer(context)
  const { uploadKey } = parseInput(newReturnPhoto, input, INVALID)
  if (UPLOAD_KEY.exec(uploadKey)?.[1] !== context.userId) {
    throw new ValidationError(INVALID, ['uploadKey is not an upload of yours'])
  }
  await assertRoomForPhoto(tx, context.userId)
  const id = randomUUID()
  let row: PhotoRow | undefined
  try {
    ;[row] = await tx
      .insert(returnPhotos)
      .values({ id, userId: context.userId, uploadKey, status: 'processing' })
      .returning()
  } catch (error) {
    if (uniqueViolation(error) === 'return_photos_upload_key_unique') {
      throw new ValidationError(INVALID, ['uploadKey was already added'])
    }
    throw error
  }
  await queue.send(tx, CHECK_RETURN_PHOTO_QUEUE, { photoId: id })
  return toView(row!)
}

/** One of the buyer's photos, for the return form to follow its check. */
export async function getReturnPhoto(
  tx: Transaction,
  context: RequestContext,
  photoId: string,
): Promise<ReturnPhotoView> {
  assertBuyer(context)
  if (!isUuid(photoId)) throw new NotFoundError(NOT_FOUND)
  const [row] = await tx
    .select()
    .from(returnPhotos)
    .where(
      and(
        eq(returnPhotos.id, photoId),
        eq(returnPhotos.userId, context.userId),
      ),
    )
  if (!row) throw new NotFoundError(NOT_FOUND)
  return toView(row)
}

/**
 * Attaches the buyer's checked photos to the return request they are
 * sending, and returns their storage keys in the order given, for
 * `return_requests.images`. For the return request flow (step 15): call it
 * in the transaction that creates the request.
 */
export async function attachReturnPhotos(
  tx: Transaction,
  context: RequestContext,
  returnRequestId: string,
  input: unknown,
): Promise<string[]> {
  assertBuyer(context)
  const photoIds = parseInput(
    returnPhotoIds,
    input,
    'Those photos cannot be sent',
  )
  if (new Set(photoIds).size !== photoIds.length) {
    throw new ValidationError('Those photos cannot be sent', [
      'photoIds lists a photo more than once',
    ])
  }
  if (photoIds.length === 0) return []
  const [request] = await tx
    .select({ id: returnRequests.id })
    .from(returnRequests)
    .where(
      and(
        eq(returnRequests.id, returnRequestId),
        eq(returnRequests.userId, context.userId),
      ),
    )
  if (!request) throw new NotFoundError('There is no return with that id')

  const rows = await tx
    .select()
    .from(returnPhotos)
    .where(
      and(
        inArray(returnPhotos.id, photoIds),
        eq(returnPhotos.userId, context.userId),
      ),
    )
    .for('update')
  const byId = new Map(rows.map((row) => [row.id, row]))
  const issues: string[] = []
  for (const id of photoIds) {
    const row = byId.get(id)
    if (!row) issues.push(`photo ${id} is not one of your photos`)
    else if (row.status === 'failed') {
      issues.push(`photo ${id} failed the check: ${row.failureReason}`)
    } else if (row.returnRequestId) {
      issues.push(`photo ${id} was already sent with a return`)
    }
  }
  if (issues.length > 0) {
    throw new ValidationError('Those photos cannot be sent', issues)
  }
  if (rows.some((row) => row.status === 'processing')) {
    throw new ConflictError(
      'A photo is still being checked; wait a moment and send the return again',
    )
  }
  await tx
    .update(returnPhotos)
    .set({ returnRequestId })
    .where(inArray(returnPhotos.id, photoIds))
  return photoIds.map((id) => byId.get(id)!.storageKey!)
}

/**
 * A five-minute link to a checked photo, for the buyer who took it, the
 * seller of the returned item once the photo is part of a return, and
 * administrators. The link is signed outside the transaction.
 */
export async function getReturnPhotoDownload(
  { db, storage }: { db: Database; storage: ObjectStorage },
  context: RequestContext,
  photoId: string,
): Promise<ReturnPhotoDownload> {
  if (context.role === 'anonymous') throw new NotSignedInError()
  if (!isUuid(photoId)) throw new NotFoundError(NOT_FOUND)
  const photo = await withContext(db, context, async (tx) => {
    const [row] = await tx
      .select({
        userId: returnPhotos.userId,
        status: returnPhotos.status,
        storageKey: returnPhotos.storageKey,
        sellerId: returnRequests.sellerId,
      })
      .from(returnPhotos)
      .leftJoin(
        returnRequests,
        eq(returnRequests.id, returnPhotos.returnRequestId),
      )
      .where(eq(returnPhotos.id, photoId))
    return row
  })
  const allowed =
    photo &&
    (context.role === 'admin' ||
      context.role === 'system' ||
      (context.role === 'buyer' && photo.userId === context.userId) ||
      (context.role === 'seller' && photo.sellerId === context.sellerId))
  if (!allowed) throw new NotFoundError(NOT_FOUND)
  if (!photo.storageKey) {
    throw new ConflictError(
      photo.status === 'failed'
        ? 'This photo failed the check, so there is nothing to show'
        : 'The photo is still being checked; try again in a moment',
    )
  }
  const fileName = `return-photo-${photoId.slice(0, 8)}.jpg`
  // Counted before signing, so the link never outlives what this says.
  const expiresAt = new Date(Date.now() + DOWNLOAD_SECONDS * 1000)
  const url = await storage.createDownloadUrl(photo.storageKey, {
    expiresInSeconds: DOWNLOAD_SECONDS,
    fileName,
  })
  return { url, expiresAt, fileName }
}
