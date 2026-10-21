import { and, eq, sql } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import {
  auditLogs,
  sellerDocumentFiles,
  sellerDocumentRequests,
  sellers,
} from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import { ConflictError, ForbiddenError, NotFoundError } from '../../errors.ts'
import { startJobQueue, type JobQueue } from '../../lib/queue.ts'
import {
  createObjectStorage,
  loadStorageConfig,
  type ObjectStorage,
} from '../../lib/storage.ts'
import { rejectionOf, validationIssues } from '../../testing/errors.ts'
import { testPdf } from '../../testing/files.ts'
import { createTestSeller, createTestUser } from '../../testing/fixtures.ts'
import { holdRows, sessionsWaitingOn, waitUntil } from '../../testing/locks.ts'
import {
  acceptSellerDocument,
  addDocumentFile,
  cancelSellerDocument,
  CHECK_DOCUMENT_QUEUE,
  createDocumentUpload,
  getDocumentDownload,
  getDocumentRequest,
  listDocumentsToReview,
  listOwnDocumentRequests,
  listSellerDocumentRequests,
  rejectSellerDocument,
  requestSellerDocuments,
} from './documents.ts'
import { checkUploadedDocument } from './jobs.ts'
import { approveSeller } from './service.ts'
import type { DocumentRequestView } from './types.ts'

/*
 * Verification documents (design doc 5.4) against the real database, job
 * queue, and object storage: an administrator asks, the seller uploads, the
 * worker checks, and the administrator decides.
 */

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'seller-documents-test')
  pools.push(pool)
  return createDatabase(pool)
}
const web = connect(requireEnv('DATABASE_URL'))
const worker = connect(requireEnv('WORKER_DATABASE_URL'))
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))
const storage = createObjectStorage(loadStorageConfig())
const deps = { db: worker, storage }
let queue: JobQueue
let admin: Extract<RequestContext, { role: 'admin' }>

beforeAll(async () => {
  queue = await startJobQueue(
    requireEnv('DATABASE_URL'),
    'seller-documents-test',
  )
  admin = { role: 'admin', userId: (await createTestUser(owner, 'admin')).id }
})

afterAll(async () => {
  await queue.stop()
  await Promise.all(pools.map((pool) => pool.end()))
})

type TestSeller = Awaited<ReturnType<typeof createTestSeller>>

const sellerContext = ({ owner: user, seller }: TestSeller) =>
  ({
    role: 'seller',
    userId: user.id,
    sellerId: seller.id,
  }) satisfies RequestContext

const asAdmin = <T>(work: Parameters<typeof withContext<T>>[2]) =>
  withContext(web, admin, work)

async function ask(
  sellerId: string,
  documents = [{ type: 'gst_certificate', note: 'The full GST certificate' }],
): Promise<DocumentRequestView[]> {
  return asAdmin((tx) =>
    requestSellerDocuments(tx, admin, sellerId, { documents }),
  )
}

/**
 * What the seller's browser does: asks for a form, posts the file to it,
 * and adds the upload. The post is stood in for by a direct write.
 */
async function upload(
  seller: TestSeller,
  requestId: string,
  bytes: Buffer,
  contentType:
    'application/pdf' | 'image/jpeg' | 'image/png' = 'application/pdf',
): Promise<{ view: DocumentRequestView; fileId: string; uploadKey: string }> {
  const context = sellerContext(seller)
  const form = await createDocumentUpload(
    { db: web, storage },
    context,
    requestId,
    {
      contentType,
      size: Math.max(bytes.length, 1),
    },
  )
  if (bytes.length > 0) {
    await storage.write(form.key, bytes, { contentType })
  }
  const view = await withContext(web, context, (tx) =>
    addDocumentFile(tx, queue, context, requestId, { uploadKey: form.key }),
  )
  return { view, fileId: view.files[0]!.id, uploadKey: form.key }
}

/** Asks, uploads a PDF, and lets the worker check it. */
async function receivedDocument(seller: TestSeller, type = 'pan_card') {
  const [request] = await ask(seller.seller.id, [
    { type, note: 'A clear copy, both sides' },
  ])
  const { fileId } = await upload(seller, request!.id, testPdf())
  await checkUploadedDocument(deps, fileId)
  return { requestId: request!.id, fileId }
}

const read = (context: RequestContext, requestId: string) =>
  withContext(web, context, (tx) => getDocumentRequest(tx, context, requestId))

async function auditFor(requestId: string) {
  return owner
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.entityType, 'seller_document'),
        eq(auditLogs.entityId, requestId),
      ),
    )
    .orderBy(auditLogs.id)
}

describe('asking for documents', () => {
  test('asks a pending seller for documents and audits each request', async () => {
    const seller = await createTestSeller(owner, 'pending')
    const requests = await ask(seller.seller.id, [
      { type: 'gst_certificate', note: 'The GST registration certificate' },
      { type: 'bank_proof', note: 'A cancelled cheque of the current account' },
    ])
    expect(requests).toHaveLength(2)
    expect(requests[1]).toMatchObject({
      sellerId: seller.seller.id,
      type: 'bank_proof',
      note: 'A cancelled cheque of the current account',
      status: 'requested',
      acceptedAt: null,
      cancelledAt: null,
      files: [],
    })
    expect(await auditFor(requests[1]!.id)).toMatchObject([
      {
        actorUserId: admin.userId,
        actorRole: 'admin',
        action: 'seller_document.request',
        after: {
          sellerId: seller.seller.id,
          type: 'bank_proof',
          note: 'A cancelled cheque of the current account',
        },
      },
    ])
  })

  test('checks an approved seller again without suspending them', async () => {
    const seller = await createTestSeller(owner, 'approved')
    await ask(seller.seller.id)
    const [row] = await owner
      .select({ status: sellers.status })
      .from(sellers)
      .where(eq(sellers.id, seller.seller.id))
    expect(row!.status).toBe('approved')
  })

  test('says plainly what is wrong with the list', async () => {
    const { seller } = await createTestSeller(owner, 'pending')
    const issues = (input: unknown) =>
      validationIssues(
        asAdmin((tx) => requestSellerDocuments(tx, admin, seller.id, input)),
      )
    expect(await issues({ documents: [] })).toEqual([
      'documents must list at least one document',
    ])
    expect(
      await issues({ documents: [{ type: 'aadhaar', note: '  ' }] }),
    ).toEqual([
      'documents.0.type must be one of gst_certificate, pan_card, bank_proof, business_registration, address_proof, other',
      'documents.0.note must not be empty',
    ])
    expect(
      await issues({
        documents: Array.from({ length: 11 }, () => ({
          type: 'other',
          note: 'Anything',
        })),
      }),
    ).toEqual(['documents must list at most 10 documents'])
  })

  test('404 for an unknown seller, 403 for anyone but an administrator', async () => {
    await expect(ask(crypto.randomUUID())).rejects.toThrow(NotFoundError)
    await expect(ask('not-an-id')).rejects.toThrow(NotFoundError)
    const seller = await createTestSeller(owner, 'pending')
    const context = sellerContext(seller)
    await expect(
      withContext(web, context, (tx) =>
        requestSellerDocuments(tx, context, seller.seller.id, {
          documents: [{ type: 'other', note: 'Me' }],
        }),
      ),
    ).rejects.toThrow(ForbiddenError)
  })
})

describe('the seller’s portal list', () => {
  test('shows the seller their open requests, newest first, and nobody else’s', async () => {
    const seller = await createTestSeller(owner, 'pending')
    const other = await createTestSeller(owner, 'pending')
    await ask(other.seller.id)
    const [first] = await ask(seller.seller.id, [
      { type: 'pan_card', note: 'PAN card' },
    ])
    const [second] = await ask(seller.seller.id, [
      { type: 'address_proof', note: 'Electricity bill' },
    ])
    const [third] = await ask(seller.seller.id, [
      { type: 'other', note: 'Trade licence' },
    ])
    await asAdmin((tx) =>
      cancelSellerDocument(tx, admin, third!.id, { reason: 'Not needed' }),
    )
    const context = sellerContext(seller)
    const list = (options: Parameters<typeof listOwnDocumentRequests>[2]) =>
      withContext(web, context, (tx) =>
        listOwnDocumentRequests(tx, context, options),
      )

    const open = await list({})
    expect(open.items.map((item) => item.id)).toEqual([second!.id, first!.id])
    const all = await list({ show: 'all', limit: 2 })
    expect(all.items.map((item) => item.id)).toEqual([third!.id, second!.id])
    const rest = await list({ show: 'all', cursor: all.nextCursor! })
    expect(rest).toEqual({
      items: [expect.objectContaining({ id: first!.id })],
      nextCursor: null,
    })
    await expect(list({ show: 'closed' })).rejects.toThrow(
      'show must be open or all',
    )
  })

  test('a seller reads only their own request; buyers none', async () => {
    const seller = await createTestSeller(owner, 'pending')
    const other = await createTestSeller(owner, 'pending')
    const [request] = await ask(seller.seller.id)
    expect((await read(sellerContext(seller), request!.id)).id).toBe(
      request!.id,
    )
    await rejectionOf(read(sellerContext(other), request!.id), NotFoundError)
    const buyer = await createTestUser(owner, 'buyer')
    await rejectionOf(
      read({ role: 'buyer', userId: buyer.id }, request!.id),
      ForbiddenError,
    )
  })

  test('administrators list one seller’s requests with their history', async () => {
    const seller = await createTestSeller(owner, 'pending')
    const { requestId } = await receivedDocument(seller)
    const page = await asAdmin((tx) =>
      listSellerDocumentRequests(tx, admin, seller.seller.id),
    )
    expect(page.items).toEqual([
      expect.objectContaining({
        id: requestId,
        status: 'received',
        files: [expect.objectContaining({ status: 'received' })],
      }),
    ])
    await rejectionOf(
      asAdmin((tx) =>
        listSellerDocumentRequests(tx, admin, crypto.randomUUID()),
      ),
      NotFoundError,
    )
  })
})

describe('uploading a file', () => {
  test.each([0, 10_485_761])(
    'B01 worker rejects actual %i bytes even when the browser declares one byte',
    async (size) => {
      const seller = await createTestSeller(owner, 'pending')
      const context = sellerContext(seller)
      const [request] = await ask(seller.seller.id)
      const form = await createDocumentUpload(
        { db: web, storage },
        context,
        request!.id,
        { contentType: 'application/pdf', size: 1 },
      )
      await storage.write(form.key, Buffer.alloc(size), {
        contentType: 'application/pdf',
      })
      const registered = await withContext(web, context, (tx) =>
        addDocumentFile(tx, queue, context, request!.id, {
          uploadKey: form.key,
        }),
      )
      expect(registered.status).toBe('processing')
      await checkUploadedDocument(deps, registered.files[0]!.id)
      const checked = await asAdmin((tx) =>
        getDocumentRequest(tx, admin, request!.id),
      )
      expect(checked.status).toBe('requested')
      expect(checked.files[0]?.status).toBe('failed')
      expect(checked.files[0]?.failureReason).toBe(
        size === 0
          ? 'The file is not a PDF, JPEG, or PNG'
          : 'The file is larger than 10 MB',
      )
      expect(await storage.read(form.key)).toBeNull()
    },
  )
  test.each([10_485_759, 10_485_760])(
    'B01 checks a valid %i-byte PDF through registration and the worker',
    async (size) => {
      const seller = await createTestSeller(owner, 'pending')
      const [request] = await ask(seller.seller.id)
      const bytes = testPdf({ size })
      expect(bytes.length).toBe(size)
      const { fileId } = await upload(seller, request!.id, bytes)
      await checkUploadedDocument(deps, fileId)
      const document = await asAdmin((tx) =>
        getDocumentRequest(tx, admin, request!.id),
      )
      expect(document.status).toBe('received')
      expect(document.files[0]).toMatchObject({
        status: 'received',
        sizeBytes: size,
        contentType: 'application/pdf',
      })
    },
  )

  test.each([0, 10_485_761])(
    'B01 refuses a declared %i-byte document',
    async (size) => {
      const seller = await createTestSeller(owner, 'pending')
      const [request] = await ask(seller.seller.id)
      expect(
        await validationIssues(
          createDocumentUpload(
            { db: web, storage },
            sellerContext(seller),
            request!.id,
            { contentType: 'application/pdf', size },
          ),
        ),
      ).toEqual([
        size === 0
          ? 'size must be at least 1 byte'
          : 'size must be at most 10 MB',
      ])
    },
  )
  test('signs a private upload form for the request', async () => {
    const seller = await createTestSeller(owner, 'pending')
    const [request] = await ask(seller.seller.id)
    const form = await createDocumentUpload(
      { db: web, storage },
      sellerContext(seller),
      request!.id,
      { contentType: 'application/pdf', size: 250_000 },
    )
    expect(form.key).toMatch(
      new RegExp(`^uploads/seller-documents/${request!.id}/[0-9a-f-]{36}$`),
    )
    expect(form.maxBytes).toBe(10 * 1024 * 1024)
    expect(form.fields['Content-Type']).toBe('application/pdf')
    expect(form.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  test('takes PDF, JPEG, and PNG files up to 10 MB', async () => {
    const seller = await createTestSeller(owner, 'pending')
    const [request] = await ask(seller.seller.id)
    expect(
      await validationIssues(
        createDocumentUpload(
          { db: web, storage },
          sellerContext(seller),
          request!.id,
          {
            contentType: 'application/zip',
            size: 11 * 1024 * 1024,
          },
        ),
      ),
    ).toEqual([
      'contentType must be application/pdf, image/jpeg, or image/png',
      'size must be at most 10 MB',
    ])
  })

  test('only the seller asked can upload, and only while it waits for a file', async () => {
    const seller = await createTestSeller(owner, 'pending')
    const other = await createTestSeller(owner, 'pending')
    const [request] = await ask(seller.seller.id)
    const input = { contentType: 'application/pdf', size: 100 }
    await rejectionOf(
      createDocumentUpload(
        { db: web, storage },
        sellerContext(other),
        request!.id,
        input,
      ),
      NotFoundError,
    )
    await rejectionOf(
      createDocumentUpload({ db: web, storage }, admin, request!.id, input),
      ForbiddenError,
    )
    await upload(seller, request!.id, testPdf())
    const error = await rejectionOf(
      createDocumentUpload(
        { db: web, storage },
        sellerContext(seller),
        request!.id,
        input,
      ),
      ConflictError,
    )
    expect(error.message).toBe(
      'A file for this document is already being checked',
    )
  })

  test('adds the upload as processing and queues its check', async () => {
    const seller = await createTestSeller(owner, 'pending')
    const [request] = await ask(seller.seller.id)
    const { view, fileId } = await upload(seller, request!.id, testPdf())
    expect(view).toMatchObject({
      status: 'processing',
      files: [
        {
          id: fileId,
          status: 'processing',
          contentType: null,
          failureReason: null,
        },
      ],
    })
    const jobs = await owner.execute<{ count: number }>(
      sql`select count(*)::int as count from pgboss.job where name = ${CHECK_DOCUMENT_QUEUE} and data->>'fileId' = ${fileId}`,
    )
    expect(jobs.rows[0]!.count).toBe(1)
  })

  test('refuses an upload key that belongs to another request', async () => {
    const seller = await createTestSeller(owner, 'pending')
    const [first, second] = await ask(seller.seller.id, [
      { type: 'pan_card', note: 'PAN' },
      { type: 'gst_certificate', note: 'GST' },
    ])
    const context = sellerContext(seller)
    const form = await createDocumentUpload(
      { db: web, storage },
      context,
      first!.id,
      {
        contentType: 'application/pdf',
        size: 100,
      },
    )
    for (const uploadKey of [
      form.key,
      `uploads/${second!.id}/${crypto.randomUUID()}`,
    ]) {
      expect(
        await validationIssues(
          withContext(web, context, (tx) =>
            addDocumentFile(tx, queue, context, second!.id, { uploadKey }),
          ),
        ),
      ).toEqual(['uploadKey is not an upload for this document'])
    }
  })
})

describe('the worker’s check', () => {
  test('keeps a checked copy, marks it received, and removes the upload', async () => {
    const seller = await createTestSeller(owner, 'pending')
    const [request] = await ask(seller.seller.id)
    const pdf = testPdf()
    const { fileId, uploadKey } = await upload(seller, request!.id, pdf)
    await checkUploadedDocument(deps, fileId)

    const view = await read(sellerContext(seller), request!.id)
    expect(view).toMatchObject({
      status: 'received',
      files: [
        {
          status: 'received',
          contentType: 'application/pdf',
          sizeBytes: pdf.length,
          failureReason: null,
        },
      ],
    })
    const [file] = await owner
      .select()
      .from(sellerDocumentFiles)
      .where(eq(sellerDocumentFiles.id, fileId))
    expect(file!.storageKey).toBe(
      `seller-documents/${seller.seller.id}/${fileId}`,
    )
    expect((await storage.read(file!.storageKey!))!.equals(pdf)).toBe(true)
    expect(await storage.read(uploadKey)).toBeNull()
    // Private: only a signed link opens it.
    expect((await fetch(storage.publicUrl(file!.storageKey!))).status).toBe(403)

    // A second run changes nothing.
    await checkUploadedDocument(deps, fileId)
    expect((await read(admin, request!.id)).status).toBe('received')
  })

  test('re-encodes a photo of the document', async () => {
    const seller = await createTestSeller(owner, 'pending')
    const [request] = await ask(seller.seller.id)
    const jpeg = await sharp({
      create: { width: 900, height: 600, channels: 3, background: '#eeeeee' },
    })
      .withExif({ IFD0: { Make: 'PhoneCo' } })
      .jpeg()
      .toBuffer()
    const { fileId } = await upload(seller, request!.id, jpeg, 'image/jpeg')
    await checkUploadedDocument(deps, fileId)
    const stored = await storage.read(
      `seller-documents/${seller.seller.id}/${fileId}`,
    )
    expect((await sharp(stored!).metadata()).exif).toBeUndefined()
  })

  test('a file that fails the check goes back to the seller with the reason', async () => {
    const seller = await createTestSeller(owner, 'pending')
    const [request] = await ask(seller.seller.id)
    // The browser claimed a PDF; the bytes say otherwise.
    const { fileId, uploadKey } = await upload(
      seller,
      request!.id,
      Buffer.from('MZ not a document'),
    )
    await checkUploadedDocument(deps, fileId)
    const view = await read(sellerContext(seller), request!.id)
    expect(view).toMatchObject({
      status: 'requested',
      files: [
        {
          status: 'failed',
          failureReason: 'The file is not a PDF, JPEG, or PNG',
        },
      ],
    })
    expect(await storage.read(uploadKey)).toBeNull()

    // The seller tries again with a good file.
    const again = await upload(seller, request!.id, testPdf())
    await checkUploadedDocument(deps, again.fileId)
    const history = (await read(sellerContext(seller), request!.id)).files
    expect(history.map((file) => file.status)).toEqual(['received', 'failed'])
  })

  test('says so when the upload never arrived', async () => {
    const seller = await createTestSeller(owner, 'pending')
    const [request] = await ask(seller.seller.id)
    const { fileId } = await upload(seller, request!.id, Buffer.alloc(0))
    await checkUploadedDocument(deps, fileId)
    expect((await read(admin, request!.id)).files[0]).toMatchObject({
      status: 'failed',
      failureReason: 'The upload did not arrive; upload the file again',
    })
  })

  test('retries when storage fails, and gives up plainly on the last try', async () => {
    const seller = await createTestSeller(owner, 'pending')
    const [request] = await ask(seller.seller.id)
    const { fileId } = await upload(seller, request!.id, testPdf())
    const failing: ObjectStorage = {
      ...storage,
      write: () => Promise.reject(new Error('Storage is unavailable')),
    }
    await expect(
      checkUploadedDocument({ db: worker, storage: failing }, fileId, {
        lastAttempt: false,
      }),
    ).rejects.toThrow('Storage is unavailable')
    expect((await read(admin, request!.id)).status).toBe('processing')

    await checkUploadedDocument({ db: worker, storage: failing }, fileId)
    expect(await read(admin, request!.id)).toMatchObject({
      status: 'requested',
      files: [
        {
          status: 'failed',
          failureReason: 'The file could not be checked; upload it again',
        },
      ],
    })
  })
})

describe('the administrator’s decision', () => {
  test('accepts the file waiting for review, once', async () => {
    const seller = await createTestSeller(owner, 'pending')
    const { requestId, fileId } = await receivedDocument(seller)
    const accepted = await asAdmin((tx) =>
      acceptSellerDocument(tx, admin, requestId, '203.0.113.9'),
    )
    expect(accepted).toMatchObject({
      status: 'accepted',
      acceptedAt: expect.any(Date),
      files: [{ id: fileId, status: 'accepted', reviewedAt: expect.any(Date) }],
    })
    const again = await asAdmin((tx) =>
      acceptSellerDocument(tx, admin, requestId),
    )
    expect(again.acceptedAt).toEqual(accepted.acceptedAt)
    expect((await auditFor(requestId)).at(-1)).toMatchObject({
      action: 'seller_document.accept',
      before: { status: 'received' },
      after: { status: 'accepted', fileId },
      ip: '203.0.113.9',
    })
    await rejectionOf(
      asAdmin((tx) =>
        rejectSellerDocument(tx, admin, requestId, { reason: 'Too late' }),
      ),
      ConflictError,
    )
    await rejectionOf(
      asAdmin((tx) =>
        cancelSellerDocument(tx, admin, requestId, { reason: 'Too late' }),
      ),
      ConflictError,
    )
  })

  test('rejects with a reason and sends the request back for a new upload', async () => {
    const seller = await createTestSeller(owner, 'pending')
    const { requestId, fileId } = await receivedDocument(seller)
    expect(
      await validationIssues(
        asAdmin((tx) => rejectSellerDocument(tx, admin, requestId, {})),
      ),
    ).toEqual(['reason is required'])
    const rejected = await asAdmin((tx) =>
      rejectSellerDocument(tx, admin, requestId, {
        reason: 'The photo is blurred; the PAN cannot be read',
      }),
    )
    expect(rejected).toMatchObject({
      status: 'requested',
      files: [
        {
          id: fileId,
          status: 'rejected',
          rejectionReason: 'The photo is blurred; the PAN cannot be read',
        },
      ],
    })
    expect((await auditFor(requestId)).at(-1)).toMatchObject({
      action: 'seller_document.reject',
      after: {
        status: 'requested',
        fileId,
        reason: 'The photo is blurred; the PAN cannot be read',
      },
    })

    const again = await upload(seller, requestId, testPdf())
    await checkUploadedDocument(deps, again.fileId)
    const accepted = await asAdmin((tx) =>
      acceptSellerDocument(tx, admin, requestId),
    )
    expect(accepted.files.map((file) => [file.id, file.status])).toEqual([
      [again.fileId, 'accepted'],
      [fileId, 'rejected'],
    ])
  })

  test('decides only once a checked file waits for review', async () => {
    const seller = await createTestSeller(owner, 'pending')
    const [request] = await ask(seller.seller.id)
    const accept = () =>
      rejectionOf(
        asAdmin((tx) => acceptSellerDocument(tx, admin, request!.id)),
        ConflictError,
      )
    expect((await accept()).message).toBe(
      'The seller has not uploaded this document yet',
    )
    await upload(seller, request!.id, testPdf())
    expect((await accept()).message).toBe(
      'The file is still being checked; try again in a minute',
    )
    await rejectionOf(
      withContext(web, sellerContext(seller), (tx) =>
        acceptSellerDocument(tx, sellerContext(seller), request!.id),
      ),
      ForbiddenError,
    )
  })

  test('cancels a request with a reason; the seller can no longer upload', async () => {
    const seller = await createTestSeller(owner, 'pending')
    const [request] = await ask(seller.seller.id)
    expect(
      await validationIssues(
        asAdmin((tx) => cancelSellerDocument(tx, admin, request!.id, {})),
      ),
    ).toEqual(['reason is required'])
    const cancelled = await asAdmin((tx) =>
      cancelSellerDocument(tx, admin, request!.id, {
        reason: 'The GSTIN was checked on the GST portal',
      }),
    )
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      cancelledAt: expect.any(Date),
      cancelReason: 'The GSTIN was checked on the GST portal',
    })
    expect((await auditFor(request!.id)).at(-1)).toMatchObject({
      action: 'seller_document.cancel',
      before: { status: 'requested' },
      after: {
        status: 'cancelled',
        reason: 'The GSTIN was checked on the GST portal',
      },
    })
    const again = await asAdmin((tx) =>
      cancelSellerDocument(tx, admin, request!.id, { reason: 'Twice' }),
    )
    expect(again.cancelReason).toBe('The GSTIN was checked on the GST portal')
    const error = await rejectionOf(
      createDocumentUpload(
        { db: web, storage },
        sellerContext(seller),
        request!.id,
        {
          contentType: 'application/pdf',
          size: 100,
        },
      ),
      ConflictError,
    )
    expect(error.message).toBe('This document request was cancelled')
  })

  test('a check that ends after a cancellation leaves the request cancelled', async () => {
    const seller = await createTestSeller(owner, 'pending')
    const [request] = await ask(seller.seller.id)
    const { fileId } = await upload(seller, request!.id, testPdf())
    await asAdmin((tx) =>
      cancelSellerDocument(tx, admin, request!.id, { reason: 'Not needed' }),
    )
    await checkUploadedDocument(deps, fileId)
    expect(await read(admin, request!.id)).toMatchObject({
      status: 'cancelled',
      files: [{ id: fileId, status: 'received' }],
    })
    const waiting = await asAdmin((tx) =>
      listDocumentsToReview(tx, admin, { limit: 100 }),
    )
    expect(waiting.items.some((item) => item.fileId === fileId)).toBe(false)
  })
})

describe('the review queue', () => {
  test('lists checked files oldest first, with their seller', async () => {
    const seller = await createTestSeller(owner, 'pending')
    const first = await receivedDocument(seller, 'pan_card')
    const second = await receivedDocument(seller, 'gst_certificate')
    const all: string[] = []
    let cursor: string | undefined
    do {
      const page = await asAdmin((tx) =>
        listDocumentsToReview(tx, admin, {
          limit: 2,
          ...(cursor ? { cursor } : {}),
        }),
      )
      all.push(...page.items.map((item) => item.fileId))
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    expect(all.indexOf(first.fileId)).toBeLessThan(all.indexOf(second.fileId))
    expect(new Set(all).size).toBe(all.length)

    const [item] = (
      await asAdmin((tx) => listDocumentsToReview(tx, admin, { limit: 100 }))
    ).items.filter((entry) => entry.fileId === first.fileId)
    expect(item).toMatchObject({
      seller: {
        id: seller.seller.id,
        displayName: seller.seller.displayName,
        status: 'pending',
      },
      request: { id: first.requestId, type: 'pan_card', status: 'received' },
      uploadedAt: expect.any(Date),
    })
    await rejectionOf(
      withContext(web, sellerContext(seller), (tx) =>
        listDocumentsToReview(tx, sellerContext(seller)),
      ),
      ForbiddenError,
    )
  })
})

describe('downloading a file', () => {
  test('gives administrators a five-minute link and audits it', async () => {
    const seller = await createTestSeller(owner, 'pending')
    const { requestId, fileId } = await receivedDocument(
      seller,
      'gst_certificate',
    )
    const download = await getDocumentDownload(
      { db: web, storage },
      admin,
      requestId,
      fileId,
      '203.0.113.7',
    )
    const day = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Kolkata',
    })
    expect(download.fileName).toBe(
      `${seller.seller.slug}-gst-certificate-${day}.pdf`,
    )
    const remaining = download.expiresAt.getTime() - Date.now()
    expect(remaining).toBeGreaterThan(4 * 60_000)
    expect(remaining).toBeLessThanOrEqual(5 * 60_000)
    const response = await fetch(download.url)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain(
      `filename="${download.fileName}"`,
    )
    expect(Buffer.from(await response.arrayBuffer()).equals(testPdf())).toBe(
      true,
    )
    expect((await auditFor(requestId)).at(-1)).toMatchObject({
      action: 'seller_document.download',
      after: { fileId },
      ip: '203.0.113.7',
    })
  })

  test('only for administrators, and only once the file is checked', async () => {
    const seller = await createTestSeller(owner, 'pending')
    const [request] = await ask(seller.seller.id)
    const { fileId } = await upload(seller, request!.id, testPdf())
    const download = (context: RequestContext, requestId = request!.id) =>
      getDocumentDownload({ db: web, storage }, context, requestId, fileId)
    expect((await rejectionOf(download(admin), ConflictError)).message).toBe(
      'The file is still being checked; try again in a minute',
    )
    await rejectionOf(download(sellerContext(seller)), ForbiddenError)
    const [other] = await ask(seller.seller.id)
    await rejectionOf(download(admin, other!.id), NotFoundError)
    await owner
      .update(sellerDocumentFiles)
      .set({ status: 'failed', failureReason: 'The file is damaged' })
      .where(eq(sellerDocumentFiles.id, fileId))
    expect((await rejectionOf(download(admin), ConflictError)).message).toBe(
      'This file failed the check, so there is nothing to download',
    )
  })
})

describe('approving a seller', () => {
  test('is refused while any document is open, saying which', async () => {
    const seller = await createTestSeller(owner, 'pending')
    await owner
      .update(sellers)
      .set({ gstin: '27AAACE1234F1Z5', pan: 'AAACE1234F', stateCode: '27' })
      .where(eq(sellers.id, seller.seller.id))
    const [gst] = await ask(seller.seller.id, [
      { type: 'gst_certificate', note: 'GST certificate' },
    ])
    const pan = await receivedDocument(seller, 'pan_card')
    const [bank] = await ask(seller.seller.id, [
      { type: 'bank_proof', note: 'Cancelled cheque' },
    ])
    await upload(seller, bank!.id, testPdf())

    const error = await rejectionOf(
      approveSeller(web, admin, seller.seller.id),
      ConflictError,
    )
    expect(error.message).toBe(
      'This seller cannot be approved until every requested document is accepted or cancelled. Still open: GST certificate (waiting for the seller to upload it), PAN card (waiting for review), bank proof (being checked)',
    )

    await asAdmin((tx) => acceptSellerDocument(tx, admin, pan.requestId))
    await asAdmin((tx) =>
      cancelSellerDocument(tx, admin, gst!.id, { reason: 'Checked online' }),
    )
    await asAdmin((tx) =>
      cancelSellerDocument(tx, admin, bank!.id, { reason: 'Not needed' }),
    )
    expect((await approveSeller(web, admin, seller.seller.id)).status).toBe(
      'approved',
    )
  })

  test('a request made while approval runs waits for it', async () => {
    const seller = await createTestSeller(owner, 'pending')
    await owner
      .update(sellers)
      .set({ gstin: '27AAACE1234F1Z5', pan: 'AAACE1234F' })
      .where(eq(sellers.id, seller.seller.id))
    // Approval holds the seller row; the request queues behind it.
    const held = await holdRows(owner, sellers, sellers.id, [seller.seller.id])
    const asking = ask(seller.seller.id)
    await waitUntil(async () => (await sessionsWaitingOn(owner, held.pid)) > 0)
    held.release()
    await held.finished
    const [request] = await asking
    expect(request!.status).toBe('requested')
  })
})

describe('races', () => {
  test('two uploads for one request at once: one is checked, the other refused', async () => {
    const seller = await createTestSeller(owner, 'pending')
    const [request] = await ask(seller.seller.id)
    const context = sellerContext(seller)
    const forms = await Promise.all(
      [1, 2].map(() =>
        createDocumentUpload({ db: web, storage }, context, request!.id, {
          contentType: 'application/pdf',
          size: 100,
        }),
      ),
    )
    const held = await holdRows(
      owner,
      sellerDocumentRequests,
      sellerDocumentRequests.id,
      [request!.id],
    )
    const adding = forms.map((form) =>
      withContext(web, context, (tx) =>
        addDocumentFile(tx, queue, context, request!.id, {
          uploadKey: form.key,
        }),
      ),
    )
    await waitUntil(
      async () => (await sessionsWaitingOn(owner, held.pid)) === 2,
    )
    held.release()
    const results = await Promise.allSettled(adding)
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    const [refused] = results.filter((result) => result.status === 'rejected')
    expect(refused!.reason).toBeInstanceOf(ConflictError)
    const files = await owner
      .select()
      .from(sellerDocumentFiles)
      .where(eq(sellerDocumentFiles.requestId, request!.id))
    expect(files).toHaveLength(1)
  })

  test('accepting and cancelling at once: exactly one happens', async () => {
    const seller = await createTestSeller(owner, 'pending')
    const { requestId } = await receivedDocument(seller)
    const held = await holdRows(
      owner,
      sellerDocumentRequests,
      sellerDocumentRequests.id,
      [requestId],
    )
    const accepting = asAdmin((tx) =>
      acceptSellerDocument(tx, admin, requestId),
    )
    const cancelling = asAdmin((tx) =>
      cancelSellerDocument(tx, admin, requestId, { reason: 'Not needed' }),
    )
    await waitUntil(
      async () => (await sessionsWaitingOn(owner, held.pid)) === 2,
    )
    held.release()
    const [accepted, cancelled] = await Promise.allSettled([
      accepting,
      cancelling,
    ])
    const final = await read(admin, requestId)
    const [winner, loser] =
      final.status === 'accepted'
        ? [accepted, cancelled]
        : [cancelled, accepted]
    expect(winner.status).toBe('fulfilled')
    // The loser is told plainly, not with a database error.
    expect(loser.status === 'rejected' && loser.reason).toBeInstanceOf(
      ConflictError,
    )
    // A cancelled request keeps its file as it was.
    expect(final.files[0]!.status).toBe(
      final.status === 'cancelled' ? 'received' : 'accepted',
    )
  })
})
