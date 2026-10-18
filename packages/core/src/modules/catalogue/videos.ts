import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Database, Transaction } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { productVideos } from '../../db/schema/index.ts'
import { ConflictError, NotFoundError, ValidationError } from '../../errors.ts'
import { uniqueViolation } from '../../lib/postgres.ts'
import type { JobQueue, QueueDefinition } from '../../lib/queue.ts'
import type { ObjectStorage } from '../../lib/storage.ts'
import { parseInput } from '../../lib/validation.ts'
import { MAX_VIDEO_UPLOAD_BYTES } from '../../lib/videos.ts'
import {
  assertEditable,
  assertSeller,
  lockOwnProduct,
  readProductView,
  type PhotoAddresses,
} from './products.ts'
import {
  newVideo,
  videoUploadRequest,
  type ImageUpload,
  type ProductView,
} from './types.ts'

/*
 * A product's one optional video. It works like a photo: the browser uploads
 * the file straight to object storage with a signed form, the seller adds it
 * here, and the worker checks and converts it (jobs.ts). It changes only
 * while listing details may change.
 */

export const PROCESS_VIDEO_QUEUE = 'catalogue.process-video'

export const videoQueues: QueueDefinition[] = [
  {
    name: PROCESS_VIDEO_QUEUE,
    options: {
      retryLimit: 2,
      retryDelay: 60,
      retryBackoff: true,
      // Converting a one-minute 4K video can take a few minutes.
      expireInSeconds: 15 * 60,
      deleteAfterSeconds: 7 * 24 * 60 * 60,
    },
  },
]

export const processVideoJob = z.object({ videoId: z.uuid() })

// A large file on a slow connection takes a while to upload.
const UPLOAD_FORM_SECONDS = 30 * 60
// The `video-` prefix keeps video and photo uploads apart, so neither can be
// added as the other.
const UPLOAD_KEY =
  /^uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/video-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const INVALID = 'That video cannot be added'
const ONE_VIDEO = 'A product can have one video; remove the current one first'

async function assertNoVideo(
  tx: Transaction,
  productId: string,
): Promise<void> {
  const [video] = await tx
    .select({ id: productVideos.id })
    .from(productVideos)
    .where(eq(productVideos.productId, productId))
  if (video) throw new ConflictError(ONE_VIDEO)
}

/**
 * Signs a form the browser uploads the video with. The checks run in a
 * transaction first; signing happens outside it.
 */
export async function createVideoUpload(
  { db, storage }: { db: Database; storage: ObjectStorage },
  context: RequestContext,
  productId: string,
  input: unknown,
): Promise<ImageUpload> {
  assertSeller(context)
  const request = parseInput(
    videoUploadRequest,
    input,
    'That video cannot be uploaded',
  )
  await withContext(db, context, async (tx) => {
    assertEditable(await lockOwnProduct(tx, context, productId))
    await assertNoVideo(tx, productId)
  })
  const key = `uploads/${productId}/video-${randomUUID()}`
  const form = await storage.createUploadForm(key, {
    contentType: request.contentType,
    maxBytes: MAX_VIDEO_UPLOAD_BYTES,
    expiresInSeconds: UPLOAD_FORM_SECONDS,
  })
  return {
    key,
    ...form,
    maxBytes: MAX_VIDEO_UPLOAD_BYTES,
    expiresAt: new Date(Date.now() + UPLOAD_FORM_SECONDS * 1000),
  }
}

/**
 * Adds the uploaded video as `processing` and queues the job that checks and
 * converts it, in the same transaction.
 */
export async function addVideo(
  tx: Transaction,
  photos: PhotoAddresses,
  queue: JobQueue,
  context: RequestContext,
  productId: string,
  input: unknown,
): Promise<ProductView> {
  assertSeller(context)
  const { uploadKey } = parseInput(newVideo, input, INVALID)
  if (UPLOAD_KEY.exec(uploadKey)?.[1] !== productId) {
    throw new ValidationError(INVALID, [
      'uploadKey is not a video upload for this product',
    ])
  }
  assertEditable(await lockOwnProduct(tx, context, productId))
  await assertNoVideo(tx, productId)

  const id = randomUUID()
  try {
    await tx.insert(productVideos).values({
      id,
      productId,
      storageKey: `videos/${id}`,
      uploadKey,
      status: 'processing',
    })
  } catch (error) {
    const constraint = uniqueViolation(error)
    if (constraint === 'product_videos_upload_key_unique') {
      throw new ValidationError(INVALID, ['uploadKey was already added'])
    }
    if (constraint === 'product_videos_product_id_unique') {
      throw new ConflictError(ONE_VIDEO)
    }
    throw error
  }
  await queue.send(tx, PROCESS_VIDEO_QUEUE, { videoId: id })
  return readProductView(tx, photos, productId)
}

/**
 * Removes the product's video. The stored files stay, like a removed
 * photo's, and nothing links to them any more.
 */
export async function removeVideo(
  tx: Transaction,
  photos: PhotoAddresses,
  context: RequestContext,
  productId: string,
): Promise<ProductView> {
  assertSeller(context)
  assertEditable(await lockOwnProduct(tx, context, productId))
  const removed = await tx
    .delete(productVideos)
    .where(eq(productVideos.productId, productId))
    .returning({ id: productVideos.id })
  if (removed.length === 0) {
    throw new NotFoundError('This product has no video')
  }
  return readProductView(tx, photos, productId)
}
