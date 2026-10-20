import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import type { Database, Transaction } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import {
  sellerDocumentFiles,
  sellerDocumentRequests,
  sellers,
} from '../../db/schema/index.ts'
import { ConflictError, NotFoundError, ValidationError } from '../../errors.ts'
import {
  afterCursor,
  afterOldestFirstCursor,
  exactTime,
  newestFirstCursor,
  pageSize,
  toPage,
  type Page,
} from '../../lib/pagination.ts'
import { uniqueViolation } from '../../lib/postgres.ts'
import type { JobQueue, QueueDefinition } from '../../lib/queue.ts'
import type { ObjectStorage } from '../../lib/storage.ts'
import { isUuid, parseInput } from '../../lib/validation.ts'
import { recordAuditEntry } from '../audit/service.ts'
import {
  administratorActor,
  assertAdministrator,
  assertSeller,
} from './service.ts'
import {
  documentCancellation,
  documentRejection,
  documentRequests,
  documentUploadRequest,
  isDocumentType,
  MAX_DOCUMENT_BYTES,
  newDocumentFile,
  OPEN_DOCUMENT_STATUSES,
  type DocumentContentType,
  type DocumentDownload,
  type DocumentFileStatus,
  type DocumentFileView,
  type DocumentRequestStatus,
  type DocumentRequestView,
  type DocumentToReview,
  type DocumentUpload,
  type SellerStatus,
} from './types.ts'

/*
 * Verification documents (design doc 5.4). An administrator asks a seller
 * for documents; the seller uploads each file straight to object storage
 * with a signed form; the worker checks the file (jobs.ts) and keeps a clean
 * copy; the administrator downloads it through a short-lived link and
 * accepts or rejects it. A seller is approved only once every request is
 * accepted or cancelled (approveSeller in service.ts).
 *
 * Every change to a request locks the request row first, then its files.
 */

export const CHECK_DOCUMENT_QUEUE = 'sellers.check-document'

export const sellerQueues: QueueDefinition[] = [
  {
    name: CHECK_DOCUMENT_QUEUE,
    options: {
      retryLimit: 3,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 300,
      deleteAfterSeconds: 7 * 24 * 60 * 60,
    },
  },
]

export const checkDocumentJob = z.object({ fileId: z.uuid() })

const UPLOAD_FORM_SECONDS = 10 * 60
const DOWNLOAD_SECONDS = 5 * 60
const UPLOAD_KEY =
  /^uploads\/seller-documents\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Where the worker keeps the checked copy; the bucket keeps it private. */
export const documentStorageKey = (file: { id: string; sellerId: string }) =>
  `seller-documents/${file.sellerId}/${file.id}`

const NOT_FOUND = 'There is no document request with that id'
const INVALID_FILE = 'That file cannot be added'

type RequestRow = typeof sellerDocumentRequests.$inferSelect
type FileRow = typeof sellerDocumentFiles.$inferSelect

const REQUEST_STATUSES: readonly DocumentRequestStatus[] = [
  'requested',
  'processing',
  'received',
  'accepted',
  'cancelled',
]
const FILE_STATUSES: readonly DocumentFileStatus[] = [
  'processing',
  'received',
  'failed',
  'accepted',
  'rejected',
]
const CONTENT_TYPES: readonly DocumentContentType[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
]

function oneOf<T extends string>(
  allowed: readonly T[],
  value: string,
  what: string,
): T {
  const match = allowed.find((option) => option === value)
  if (match === undefined) throw new Error(`Unknown ${what} ${value}`)
  return match
}

function fileView(row: FileRow): DocumentFileView {
  return {
    id: row.id,
    status: oneOf(FILE_STATUSES, row.status, 'document file status'),
    contentType: row.contentType
      ? oneOf(CONTENT_TYPES, row.contentType, 'document content type')
      : null,
    sizeBytes: row.sizeBytes,
    failureReason: row.failureReason,
    rejectionReason: row.rejectionReason,
    uploadedAt: row.createdAt,
    reviewedAt: row.reviewedAt,
  }
}

function requestView(row: RequestRow, files: FileRow[]): DocumentRequestView {
  if (!isDocumentType(row.documentType)) {
    throw new Error(`Unknown document type ${row.documentType}`)
  }
  return {
    id: row.id,
    sellerId: row.sellerId,
    type: row.documentType,
    note: row.note,
    status: oneOf(REQUEST_STATUSES, row.status, 'document request status'),
    requestedAt: row.createdAt,
    acceptedAt: row.acceptedAt,
    cancelledAt: row.cancelledAt,
    cancelReason: row.cancelReason,
    files: files.map(fileView),
  }
}

/** Every file of each request, newest first. */
async function filesOf(
  tx: Transaction,
  requestIds: string[],
): Promise<Map<string, FileRow[]>> {
  if (requestIds.length === 0) return new Map()
  const rows = await tx
    .select()
    .from(sellerDocumentFiles)
    .where(inArray(sellerDocumentFiles.requestId, requestIds))
    .orderBy(desc(sellerDocumentFiles.createdAt), desc(sellerDocumentFiles.id))
  return Map.groupBy(rows, (row) => row.requestId)
}

async function views(
  tx: Transaction,
  rows: RequestRow[],
): Promise<DocumentRequestView[]> {
  const files = await filesOf(
    tx,
    rows.map((row) => row.id),
  )
  return rows.map((row) => requestView(row, files.get(row.id) ?? []))
}

async function readView(
  tx: Transaction,
  requestId: string,
): Promise<DocumentRequestView> {
  const [row] = await tx
    .select()
    .from(sellerDocumentRequests)
    .where(eq(sellerDocumentRequests.id, requestId))
  if (!row) throw new NotFoundError(NOT_FOUND)
  const [view] = await views(tx, [row])
  return view!
}

/** Locks one request for a change, or 404. Sellers reach only their own. */
async function lockRequest(
  tx: Transaction,
  context: RequestContext,
  requestId: string,
): Promise<RequestRow> {
  if (!isUuid(requestId)) throw new NotFoundError(NOT_FOUND)
  const [row] = await tx
    .select()
    .from(sellerDocumentRequests)
    .where(
      and(
        eq(sellerDocumentRequests.id, requestId),
        context.role === 'seller'
          ? eq(sellerDocumentRequests.sellerId, context.sellerId)
          : undefined,
      ),
    )
    .for('update')
  if (!row) throw new NotFoundError(NOT_FOUND)
  return row
}

/** A seller may upload only while the request waits for a file. */
function assertAwaitingUpload(row: RequestRow): void {
  const problems: Partial<Record<string, string>> = {
    processing: 'A file for this document is already being checked',
    received: 'A file for this document is already waiting for review',
    accepted: 'This document has already been accepted',
    cancelled: 'This document request was cancelled',
  }
  const problem = problems[row.status]
  if (problem) throw new ConflictError(problem)
}

/** An administrator may decide only once a checked file waits for review. */
function assertReceived(row: RequestRow): void {
  const problems: Partial<Record<string, string>> = {
    requested: 'The seller has not uploaded this document yet',
    processing: 'The file is still being checked; try again in a minute',
    accepted: 'This document has already been accepted',
    cancelled: 'This document request was cancelled',
  }
  const problem = problems[row.status]
  if (problem) throw new ConflictError(problem)
}

/**
 * An administrator asks a seller for one or more documents, each with a note
 * saying what is needed. Works for a pending seller and for an approved one
 * being checked again, who stays approved.
 */
export async function requestSellerDocuments(
  tx: Transaction,
  context: RequestContext,
  sellerId: string,
  input: unknown,
  ip?: string | null,
): Promise<DocumentRequestView[]> {
  assertAdministrator(context)
  const { documents } = parseInput(
    documentRequests,
    input,
    'Those document requests are not valid',
  )
  if (!isUuid(sellerId)) {
    throw new NotFoundError('There is no seller with that id')
  }
  // Approval locks the seller row too, so it either sees these requests or
  // happens before them.
  const [seller] = await tx
    .select({ id: sellers.id })
    .from(sellers)
    .where(eq(sellers.id, sellerId))
    .for('share')
  if (!seller) throw new NotFoundError('There is no seller with that id')

  const rows = await tx
    .insert(sellerDocumentRequests)
    .values(
      documents.map((document) => ({
        sellerId,
        documentType: document.type,
        note: document.note,
        requestedBy: context.userId ?? null,
      })),
    )
    .returning()
  for (const row of rows) {
    await recordAuditEntry(tx, {
      ...administratorActor(context),
      action: 'seller_document.request',
      entityType: 'seller_document',
      entityId: row.id,
      after: { sellerId, type: row.documentType, note: row.note },
      ip,
    })
  }
  return rows.map((row) => requestView(row, []))
}

/** `show` is open (the default) or all. */
function showFilter(show: string | undefined): SQL | undefined {
  if (show === undefined || show === 'open') {
    return inArray(sellerDocumentRequests.status, OPEN_DOCUMENT_STATUSES)
  }
  if (show === 'all') return undefined
  throw new ValidationError('show must be open or all')
}

async function pageOfRequests(
  tx: Transaction,
  where: SQL | undefined,
  options: { cursor?: string | undefined; limit?: number | undefined },
): Promise<Page<DocumentRequestView>> {
  const limit = pageSize(options.limit)
  const rows = await tx
    .select({
      row: sellerDocumentRequests,
      cursorTime: exactTime(sellerDocumentRequests.createdAt),
    })
    .from(sellerDocumentRequests)
    .where(
      and(
        where,
        options.cursor
          ? afterCursor(
              options.cursor,
              sellerDocumentRequests.createdAt,
              sellerDocumentRequests.id,
            )
          : undefined,
      ),
    )
    .orderBy(
      desc(sellerDocumentRequests.createdAt),
      desc(sellerDocumentRequests.id),
    )
    .limit(limit + 1)
  const shown = rows.slice(0, limit)
  const byId = new Map(
    (
      await views(
        tx,
        shown.map(({ row }) => row),
      )
    ).map((view) => [view.id, view]),
  )
  return toPage(
    rows,
    limit,
    ({ row }) => byId.get(row.id)!,
    ({ row, cursorTime }) => newestFirstCursor({ id: row.id, cursorTime }),
  )
}

/** The seller's own document requests, newest first. */
export async function listOwnDocumentRequests(
  tx: Transaction,
  context: RequestContext,
  options: { show?: string; cursor?: string; limit?: number } = {},
): Promise<Page<DocumentRequestView>> {
  assertSeller(context)
  return pageOfRequests(
    tx,
    and(
      eq(sellerDocumentRequests.sellerId, context.sellerId),
      showFilter(options.show),
    ),
    options,
  )
}

/** One seller's document requests for administrators, newest first. */
export async function listSellerDocumentRequests(
  tx: Transaction,
  context: RequestContext,
  sellerId: string,
  options: { show?: string; cursor?: string; limit?: number } = {},
): Promise<Page<DocumentRequestView>> {
  assertAdministrator(context)
  if (!isUuid(sellerId)) {
    throw new NotFoundError('There is no seller with that id')
  }
  const [seller] = await tx
    .select({ id: sellers.id })
    .from(sellers)
    .where(eq(sellers.id, sellerId))
  if (!seller) throw new NotFoundError('There is no seller with that id')
  return pageOfRequests(
    tx,
    and(
      eq(sellerDocumentRequests.sellerId, sellerId),
      options.show === undefined ? undefined : showFilter(options.show),
    ),
    options,
  )
}

/** One request with its history, for administrators or its seller. */
export async function getDocumentRequest(
  tx: Transaction,
  context: RequestContext,
  requestId: string,
): Promise<DocumentRequestView> {
  if (context.role !== 'seller') assertAdministrator(context)
  if (!isUuid(requestId)) throw new NotFoundError(NOT_FOUND)
  const view = await readView(tx, requestId)
  if (context.role === 'seller' && view.sellerId !== context.sellerId) {
    throw new NotFoundError(NOT_FOUND)
  }
  return view
}

/**
 * The administrators' review queue: files that passed the check and wait
 * for a decision, oldest first, across every seller.
 */
export async function listDocumentsToReview(
  tx: Transaction,
  context: RequestContext,
  options: { cursor?: string; limit?: number } = {},
): Promise<Page<DocumentToReview>> {
  assertAdministrator(context)
  const limit = pageSize(options.limit)
  const rows = await tx
    .select({
      id: sellerDocumentFiles.id,
      uploadedAt: sellerDocumentFiles.createdAt,
      cursorTime: exactTime(sellerDocumentFiles.createdAt),
      request: sellerDocumentRequests,
      seller: {
        id: sellers.id,
        displayName: sellers.displayName,
        status: sellers.status,
      },
    })
    .from(sellerDocumentFiles)
    .innerJoin(
      sellerDocumentRequests,
      eq(sellerDocumentRequests.id, sellerDocumentFiles.requestId),
    )
    .innerJoin(sellers, eq(sellers.id, sellerDocumentRequests.sellerId))
    .where(
      and(
        eq(sellerDocumentFiles.status, 'received'),
        // A cancelled request keeps its file, but nobody needs to review it.
        eq(sellerDocumentRequests.status, 'received'),
        options.cursor
          ? afterOldestFirstCursor(
              options.cursor,
              sellerDocumentFiles.createdAt,
              sellerDocumentFiles.id,
            )
          : undefined,
      ),
    )
    .orderBy(asc(sellerDocumentFiles.createdAt), asc(sellerDocumentFiles.id))
    .limit(limit + 1)
  const shown = rows.slice(0, limit)
  const files = await filesOf(
    tx,
    shown.map(({ request }) => request.id),
  )
  return toPage(
    rows,
    limit,
    ({ id, uploadedAt, request, seller }) => ({
      request: requestView(request, files.get(request.id) ?? []),
      seller: {
        ...seller,
        status: oneOf<SellerStatus>(
          ['pending', 'approved', 'suspended', 'rejected'],
          seller.status,
          'seller status',
        ),
      },
      fileId: id,
      uploadedAt,
    }),
    newestFirstCursor,
  )
}

/**
 * Signs a form the seller's browser uploads one file with. The checks run in
 * a transaction first; signing happens outside it.
 */
export async function createDocumentUpload(
  { db, storage }: { db: Database; storage: ObjectStorage },
  context: RequestContext,
  requestId: string,
  input: unknown,
): Promise<DocumentUpload> {
  assertSeller(context)
  const request = parseInput(
    documentUploadRequest,
    input,
    'That file cannot be uploaded',
  )
  await withContext(db, context, async (tx) => {
    assertAwaitingUpload(await lockRequest(tx, context, requestId))
  })
  const key = `uploads/seller-documents/${requestId}/${randomUUID()}`
  const form = await storage.createUploadForm(key, {
    contentType: request.contentType,
    maxBytes: MAX_DOCUMENT_BYTES,
    expiresInSeconds: UPLOAD_FORM_SECONDS,
  })
  return {
    key,
    ...form,
    maxBytes: MAX_DOCUMENT_BYTES,
    expiresAt: new Date(Date.now() + UPLOAD_FORM_SECONDS * 1000),
  }
}

/**
 * Adds an uploaded file to the seller's request as `processing` and queues
 * the job that checks it, in the same transaction.
 */
export async function addDocumentFile(
  tx: Transaction,
  queue: JobQueue,
  context: RequestContext,
  requestId: string,
  input: unknown,
): Promise<DocumentRequestView> {
  assertSeller(context)
  const { uploadKey } = parseInput(newDocumentFile, input, INVALID_FILE)
  if (UPLOAD_KEY.exec(uploadKey)?.[1] !== requestId) {
    throw new ValidationError(INVALID_FILE, [
      'uploadKey is not an upload for this document',
    ])
  }
  const request = await lockRequest(tx, context, requestId)
  assertAwaitingUpload(request)
  const id = randomUUID()
  try {
    await tx.insert(sellerDocumentFiles).values({
      id,
      requestId,
      sellerId: context.sellerId,
      uploadKey,
      status: 'processing',
      uploadedBy: context.userId,
    })
  } catch (error) {
    const constraint = uniqueViolation(error)
    if (constraint === 'seller_document_files_upload_key_unique') {
      throw new ValidationError(INVALID_FILE, ['uploadKey was already added'])
    }
    if (constraint === 'seller_document_files_live_request_id_unique') {
      throw new ConflictError(
        'A file for this document is already being checked',
      )
    }
    throw error
  }
  await tx
    .update(sellerDocumentRequests)
    .set({ status: 'processing' })
    .where(eq(sellerDocumentRequests.id, requestId))
  await queue.send(tx, CHECK_DOCUMENT_QUEUE, { fileId: id })
  return readView(tx, requestId)
}

/** The checked file waiting for review; the request is locked. */
async function receivedFile(
  tx: Transaction,
  requestId: string,
): Promise<FileRow> {
  const [file] = await tx
    .select()
    .from(sellerDocumentFiles)
    .where(
      and(
        eq(sellerDocumentFiles.requestId, requestId),
        eq(sellerDocumentFiles.status, 'received'),
      ),
    )
  if (!file) {
    throw new Error(`Document request ${requestId} has no file to review`)
  }
  return file
}

/** An administrator accepts the file waiting for review. */
export async function acceptSellerDocument(
  tx: Transaction,
  context: RequestContext,
  requestId: string,
  ip?: string | null,
): Promise<DocumentRequestView> {
  assertAdministrator(context)
  const request = await lockRequest(tx, context, requestId)
  if (request.status === 'accepted') return readView(tx, requestId)
  assertReceived(request)
  const file = await receivedFile(tx, requestId)
  const reviewer = context.userId ?? null
  await tx
    .update(sellerDocumentFiles)
    .set({ status: 'accepted', reviewedAt: sql`now()`, reviewedBy: reviewer })
    .where(eq(sellerDocumentFiles.id, file.id))
  await tx
    .update(sellerDocumentRequests)
    .set({ status: 'accepted', acceptedAt: sql`now()`, acceptedBy: reviewer })
    .where(eq(sellerDocumentRequests.id, requestId))
  await recordAuditEntry(tx, {
    ...administratorActor(context),
    action: 'seller_document.accept',
    entityType: 'seller_document',
    entityId: requestId,
    before: { status: 'received' },
    after: { status: 'accepted', fileId: file.id },
    ip,
  })
  return readView(tx, requestId)
}

/**
 * An administrator rejects the file waiting for review with a reason the
 * seller sees. The request goes back to the seller for a new upload.
 */
export async function rejectSellerDocument(
  tx: Transaction,
  context: RequestContext,
  requestId: string,
  input: unknown,
  ip?: string | null,
): Promise<DocumentRequestView> {
  assertAdministrator(context)
  const { reason } = parseInput(
    documentRejection,
    input,
    'A reason is needed to reject a document',
  )
  const request = await lockRequest(tx, context, requestId)
  assertReceived(request)
  const file = await receivedFile(tx, requestId)
  await tx
    .update(sellerDocumentFiles)
    .set({
      status: 'rejected',
      rejectionReason: reason,
      reviewedAt: sql`now()`,
      reviewedBy: context.userId ?? null,
    })
    .where(eq(sellerDocumentFiles.id, file.id))
  await tx
    .update(sellerDocumentRequests)
    .set({ status: 'requested' })
    .where(eq(sellerDocumentRequests.id, requestId))
  await recordAuditEntry(tx, {
    ...administratorActor(context),
    action: 'seller_document.reject',
    entityType: 'seller_document',
    entityId: requestId,
    before: { status: 'received' },
    after: { status: 'requested', fileId: file.id, reason },
    ip,
  })
  return readView(tx, requestId)
}

/**
 * An administrator withdraws a request that is no longer needed, with a
 * reason the seller sees. Its files stay as they are, as history. An
 * accepted document cannot be cancelled.
 */
export async function cancelSellerDocument(
  tx: Transaction,
  context: RequestContext,
  requestId: string,
  input: unknown,
  ip?: string | null,
): Promise<DocumentRequestView> {
  assertAdministrator(context)
  const { reason } = parseInput(
    documentCancellation,
    input,
    'A reason is needed to cancel a document request',
  )
  const request = await lockRequest(tx, context, requestId)
  if (request.status === 'cancelled') return readView(tx, requestId)
  if (request.status === 'accepted') {
    throw new ConflictError('An accepted document cannot be cancelled')
  }
  await tx
    .update(sellerDocumentRequests)
    .set({
      status: 'cancelled',
      cancelledAt: sql`now()`,
      cancelledBy: context.userId ?? null,
      cancelReason: reason,
    })
    .where(eq(sellerDocumentRequests.id, requestId))
  await recordAuditEntry(tx, {
    ...administratorActor(context),
    action: 'seller_document.cancel',
    entityType: 'seller_document',
    entityId: requestId,
    before: { status: request.status },
    after: { status: 'cancelled', reason },
    ip,
  })
  return readView(tx, requestId)
}

const EXTENSIONS: Record<DocumentContentType, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

/** For example green-basket-gst-certificate-2026-10-18.pdf. */
function downloadName(
  sellerSlug: string,
  documentType: string,
  uploadedAt: Date,
  contentType: DocumentContentType,
): string {
  const day = uploadedAt.toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata',
  })
  const type = documentType.replaceAll('_', '-')
  return `${sellerSlug}-${type}-${day}.${EXTENSIONS[contentType]}`
}

/**
 * A five-minute link to one checked file of a request, for administrators.
 * Every download is audited, because these files carry the seller's
 * identity and bank details. The link is signed outside the transaction.
 */
export async function getDocumentDownload(
  { db, storage }: { db: Database; storage: ObjectStorage },
  context: RequestContext,
  requestId: string,
  fileId: string,
  ip?: string | null,
): Promise<DocumentDownload> {
  assertAdministrator(context)
  if (!isUuid(requestId) || !isUuid(fileId)) {
    throw new NotFoundError('There is no file with that id')
  }
  const file = await withContext(db, context, async (tx) => {
    const [row] = await tx
      .select({
        file: sellerDocumentFiles,
        documentType: sellerDocumentRequests.documentType,
        sellerSlug: sellers.slug,
      })
      .from(sellerDocumentFiles)
      .innerJoin(
        sellerDocumentRequests,
        eq(sellerDocumentRequests.id, sellerDocumentFiles.requestId),
      )
      .innerJoin(sellers, eq(sellers.id, sellerDocumentFiles.sellerId))
      .where(
        and(
          eq(sellerDocumentFiles.id, fileId),
          eq(sellerDocumentFiles.requestId, requestId),
        ),
      )
    if (!row) throw new NotFoundError('There is no file with that id')
    const { storageKey, contentType, status } = row.file
    if (!storageKey || !contentType) {
      throw new ConflictError(
        status === 'failed'
          ? 'This file failed the check, so there is nothing to download'
          : 'The file is still being checked; try again in a minute',
      )
    }
    await recordAuditEntry(tx, {
      ...administratorActor(context),
      action: 'seller_document.download',
      entityType: 'seller_document',
      entityId: requestId,
      after: { fileId },
      ip,
    })
    return {
      storageKey,
      fileName: downloadName(
        row.sellerSlug,
        row.documentType,
        row.file.createdAt,
        oneOf(CONTENT_TYPES, contentType, 'document content type'),
      ),
    }
  })
  // Counted before signing, so the link never outlives what this says.
  const expiresAt = new Date(Date.now() + DOWNLOAD_SECONDS * 1000)
  const url = await storage.createDownloadUrl(file.storageKey, {
    expiresInSeconds: DOWNLOAD_SECONDS,
    fileName: file.fileName,
  })
  return { url, expiresAt, fileName: file.fileName }
}
