import {
  createDatabase,
  createObjectStorage,
  createPool,
  loadStorageConfig,
  requireEnv,
  schema,
} from '@ecokart/core'
import {
  createTestSeller,
  createTestUser,
  testPdf,
} from '@ecokart/core/testing'
import { checkUploadedDocument } from '@ecokart/core/worker'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { POST as approve } from '@/app/api/admin/sellers/[id]/approve/route'
import {
  GET as adminList,
  POST as ask,
} from '@/app/api/admin/sellers/[id]/documents/route'
import { POST as accept } from '@/app/api/admin/seller-documents/[id]/accept/route'
import { POST as cancel } from '@/app/api/admin/seller-documents/[id]/cancel/route'
import { GET as download } from '@/app/api/admin/seller-documents/[id]/files/[fileId]/route'
import { POST as reject } from '@/app/api/admin/seller-documents/[id]/reject/route'
import { GET as reviewQueue } from '@/app/api/admin/seller-documents/route'
import { closePool } from '@/lib/db'
import { closeJobQueue } from '@/lib/queue'
import { apiRequest as request, withId } from '@/testing/requests'
import { signInWithEmail } from '@/testing/sign-in'
import { POST as addFile } from './[id]/files/route'
import { GET as readOne } from './[id]/route'
import { POST as uploadForm } from './[id]/uploads/route'
import { GET as list } from './route'

/*
 * Seller verification documents through the API (design doc 5.4): an
 * administrator asks, the seller uploads straight to object storage, the
 * worker's check runs (called directly), and the administrator decides.
 */

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'seller-documents-route-test',
)
const owner = createDatabase(ownerPool)
const storage = createObjectStorage(loadStorageConfig())

let sellerId: string
let sellerCookie: string
let otherSellerCookie: string
let buyerCookie: string
let adminCookie: string

beforeAll(async () => {
  const [seller, otherSeller, buyer, admin] = await Promise.all([
    createTestSeller(owner, 'pending'),
    createTestSeller(owner, 'pending'),
    createTestUser(owner, 'buyer'),
    createTestUser(owner, 'admin'),
  ])
  sellerId = seller.seller.id
  await owner
    .update(schema.sellers)
    .set({ gstin: '27AAACE1234F1Z5', pan: 'AAACE1234F' })
    .where(eq(schema.sellers.id, sellerId))
  ;[sellerCookie, otherSellerCookie, buyerCookie, adminCookie] =
    await Promise.all([
      signInWithEmail(owner, seller.owner.email),
      signInWithEmail(owner, otherSeller.owner.email),
      signInWithEmail(owner, buyer.email),
      signInWithEmail(owner, admin.email),
    ])
})

afterAll(async () => {
  await closeJobQueue()
  await closePool()
  await ownerPool.end()
})

const file = z
  .object({
    id: z.string(),
    status: z.string(),
    failureReason: z.string().nullable(),
    rejectionReason: z.string().nullable(),
  })
  .loose()
const documentView = z
  .object({
    id: z.string(),
    type: z.string(),
    status: z.string(),
    files: z.array(file),
  })
  .loose()
const one = z.object({ document: documentView })
const page = z.object({ items: z.array(documentView), nextCursor: z.null() })
const failure = z.object({ error: z.string(), issues: z.array(z.string()) })

const withIds = (id: string, fileId: string) => ({
  params: Promise.resolve({ id, fileId }),
})

/** What the seller's browser does for one file. */
async function sendFile(
  requestId: string,
  bytes: Buffer,
  contentType = 'application/pdf',
): Promise<string> {
  const asked = await uploadForm(
    request(`/seller/documents/${requestId}/uploads`, {
      method: 'POST',
      cookie: sellerCookie,
      body: { contentType, size: bytes.length },
    }),
    withId(requestId),
  )
  expect(asked.status).toBe(201)
  const { upload } = z
    .object({
      upload: z.object({
        key: z.string(),
        url: z.string(),
        fields: z.record(z.string(), z.string()),
      }),
    })
    .parse(await asked.json())
  const body = new FormData()
  for (const [name, value] of Object.entries(upload.fields)) {
    body.append(name, value)
  }
  body.append('file', new Blob([new Uint8Array(bytes)]))
  expect((await fetch(upload.url, { method: 'POST', body })).status).toBe(204)

  const added = await addFile(
    request(`/seller/documents/${requestId}/files`, {
      method: 'POST',
      cookie: sellerCookie,
      body: { uploadKey: upload.key },
    }),
    withId(requestId),
  )
  expect(added.status).toBe(202)
  const { document } = one.parse(await added.json())
  expect(document.status).toBe('processing')
  const fileId = document.files[0]!.id
  await checkUploadedDocument({ db: owner, storage }, fileId)
  return fileId
}

const askAs = (cookie: string | undefined, body: unknown) =>
  ask(
    request(`/admin/sellers/${sellerId}/documents`, {
      method: 'POST',
      ...(cookie ? { cookie } : {}),
      body,
    }),
    withId(sellerId),
  )

const approveSeller = () =>
  approve(
    request(`/admin/sellers/${sellerId}/approve`, {
      method: 'POST',
      cookie: adminCookie,
    }),
    withId(sellerId),
  )

describe('seller verification documents', () => {
  let gstId: string
  let panId: string

  test('an administrator asks the seller for documents', async () => {
    const response = await askAs(adminCookie, {
      documents: [
        { type: 'gst_certificate', note: 'The GST registration certificate' },
        { type: 'pan_card', note: 'The PAN card of the business' },
      ],
    })
    expect(response.status).toBe(201)
    const { documents } = z
      .object({ documents: z.array(documentView) })
      .parse(await response.json())
    gstId = documents[0]!.id
    panId = documents[1]!.id
    expect(documents.map((document) => document.status)).toEqual([
      'requested',
      'requested',
    ])
  })

  test('only administrators may ask, with plain messages for bad input', async () => {
    const valid = { documents: [{ type: 'other', note: 'Anything' }] }
    expect((await askAs(undefined, valid)).status).toBe(401)
    expect((await askAs(sellerCookie, valid)).status).toBe(403)
    const invalid = await askAs(adminCookie, { documents: [{ type: 'pan' }] })
    expect(invalid.status).toBe(400)
    expect(failure.parse(await invalid.json())).toEqual({
      error: 'Those document requests are not valid',
      issues: [
        'documents.0.type must be one of gst_certificate, pan_card, bank_proof, business_registration, address_proof, other',
        'documents.0.note is required',
      ],
    })
  })

  test('the seller sees what is asked of them; nobody else does', async () => {
    const response = await list(
      request('/seller/documents', { cookie: sellerCookie }),
    )
    expect(response.status).toBe(200)
    expect(
      page
        .parse(await response.json())
        .items.map((item) => item.id)
        .toSorted(),
    ).toEqual([gstId, panId].toSorted())

    const other = await readOne(
      request(`/seller/documents/${gstId}`, { cookie: otherSellerCookie }),
      withId(gstId),
    )
    expect(other.status).toBe(404)
    const buyer = await list(
      request('/seller/documents', { cookie: buyerCookie }),
    )
    expect(buyer.status).toBe(403)
  })

  test('approval waits for the documents', async () => {
    const response = await approveSeller()
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error:
        'This seller cannot be approved until every requested document is accepted or cancelled. Still open: GST certificate (waiting for the seller to upload it), PAN card (waiting for the seller to upload it)',
    })
  })

  test('the seller uploads; a file that is not a document goes back to them', async () => {
    const fileId = await sendFile(panId, Buffer.from('just some text'))
    const response = await readOne(
      request(`/seller/documents/${panId}`, { cookie: sellerCookie }),
      withId(panId),
    )
    const { document } = one.parse(await response.json())
    expect(document).toMatchObject({
      status: 'requested',
      files: [
        {
          id: fileId,
          status: 'failed',
          failureReason: 'The file is not a PDF, JPEG, or PNG',
        },
      ],
    })
  })

  test('storage itself refuses a file larger than the form allows', async () => {
    const asked = await uploadForm(
      request(`/seller/documents/${panId}/uploads`, {
        method: 'POST',
        cookie: sellerCookie,
        body: { contentType: 'application/pdf', size: 1000 },
      }),
      withId(panId),
    )
    const { upload } = z
      .object({
        upload: z.object({
          url: z.string(),
          fields: z.record(z.string(), z.string()),
        }),
      })
      .parse(await asked.json())
    const body = new FormData()
    for (const [name, value] of Object.entries(upload.fields)) {
      body.append(name, value)
    }
    body.append('file', new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]))
    expect((await fetch(upload.url, { method: 'POST', body })).status).toBe(400)
  })

  test('the administrator reviews, downloads, rejects, and accepts', async () => {
    const first = await sendFile(panId, testPdf())
    const queue = await reviewQueue(
      request('/admin/seller-documents?limit=100', { cookie: adminCookie }),
    )
    expect(queue.status).toBe(200)
    const waiting = z
      .object({ items: z.array(z.object({ fileId: z.string() }).loose()) })
      .parse(await queue.json())
    expect(waiting.items.map((item) => item.fileId)).toContain(first)

    const redirect = await download(
      request(`/admin/seller-documents/${panId}/files/${first}`, {
        cookie: adminCookie,
      }),
      withIds(panId, first),
    )
    expect(redirect.status).toBe(302)
    expect(redirect.headers.get('cache-control')).toBe('no-store')
    const fetched = await fetch(redirect.headers.get('location')!)
    expect(fetched.status).toBe(200)
    expect(Buffer.from(await fetched.arrayBuffer()).equals(testPdf())).toBe(
      true,
    )
    const sellerDownload = await download(
      request(`/admin/seller-documents/${panId}/files/${first}`, {
        cookie: sellerCookie,
      }),
      withIds(panId, first),
    )
    expect(sellerDownload.status).toBe(403)

    const rejected = await reject(
      request(`/admin/seller-documents/${panId}/reject`, {
        method: 'POST',
        cookie: adminCookie,
        body: { reason: 'The PAN number cannot be read' },
      }),
      withId(panId),
    )
    expect(rejected.status).toBe(200)
    expect(one.parse(await rejected.json()).document).toMatchObject({
      status: 'requested',
      files: [
        {
          status: 'rejected',
          rejectionReason: 'The PAN number cannot be read',
        },
        { status: 'failed' },
      ],
    })

    await sendFile(panId, testPdf())
    const accepted = await accept(
      request(`/admin/seller-documents/${panId}/accept`, {
        method: 'POST',
        cookie: adminCookie,
      }),
      withId(panId),
    )
    expect(accepted.status).toBe(200)
    expect(one.parse(await accepted.json()).document.status).toBe('accepted')
  })

  test('cancelling the last open request lets the approval through', async () => {
    const noReason = await cancel(
      request(`/admin/seller-documents/${gstId}/cancel`, {
        method: 'POST',
        cookie: adminCookie,
        body: {},
      }),
      withId(gstId),
    )
    expect(noReason.status).toBe(400)
    const cancelled = await cancel(
      request(`/admin/seller-documents/${gstId}/cancel`, {
        method: 'POST',
        cookie: adminCookie,
        body: { reason: 'The GSTIN was checked on the GST portal' },
      }),
      withId(gstId),
    )
    expect(cancelled.status).toBe(200)

    const history = await adminList(
      request(`/admin/sellers/${sellerId}/documents`, { cookie: adminCookie }),
      withId(sellerId),
    )
    expect(
      page
        .parse(await history.json())
        .items.map((item) => `${item.type} ${item.status}`)
        .toSorted(),
    ).toEqual(['gst_certificate cancelled', 'pan_card accepted'])
    const openNow = await list(
      request('/seller/documents', { cookie: sellerCookie }),
    )
    expect(page.parse(await openNow.json()).items).toEqual([])

    const approved = await approveSeller()
    expect(approved.status).toBe(200)
  })
})
