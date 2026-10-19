import {
  createDatabase,
  createObjectStorage,
  createPool,
  loadStorageConfig,
  requireEnv,
} from '@ecokart/core'
import {
  createTestCategory,
  createTestSeller,
  createTestWorkbook,
} from '@ecokart/core/testing'
import { readImportFile, runImport } from '@ecokart/core/worker'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { closePool } from '@/lib/db'
import { closeJobQueue, getJobQueue } from '@/lib/queue'
import { apiRequest as request } from '@/testing/requests'
import { signInWithEmail } from '@/testing/sign-in'
import { GET as errorReport } from './[id]/error-report/route'
import { PUT as setMapping } from './[id]/mapping/route'
import { GET as getImport } from './[id]/route'
import { POST as create, GET as list } from './route'
import { POST as requestUpload } from './uploads/route'

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'imports-route-test',
)
const owner = createDatabase(ownerPool)
const storage = createObjectStorage(loadStorageConfig())
// The worker's jobs, run here the way the worker would, with AI switched
// off; the AI's part of the suggestion is tested in packages/core.
const jobs = async () => ({
  db: owner,
  storage,
  ai: null,
  queue: await getJobQueue(),
})

let sellerCookie: string
let otherSellerCookie: string
let buyerCookie: string
let categoryName: string

beforeAll(async () => {
  const [seller, other] = await Promise.all([
    createTestSeller(owner),
    createTestSeller(owner),
  ])
  sellerCookie = await signInWithEmail(owner, seller.owner.email)
  otherSellerCookie = await signInWithEmail(owner, other.owner.email)
  buyerCookie = await signInWithEmail(
    owner,
    `${crypto.randomUUID()}@example.test`,
  )
  categoryName = (await createTestCategory(owner)).name
})

afterAll(async () => {
  await closeJobQueue()
  await closePool()
  await ownerPool.end()
})

const params = (id: string) => ({ params: Promise.resolve({ id }) })

const uploadResponse = z.object({
  upload: z.object({
    key: z.string(),
    url: z.string(),
    fields: z.record(z.string(), z.string()),
  }),
})
const importResponse = z.object({
  import: z
    .object({
      id: z.string(),
      status: z.string(),
      headers: z.array(z.string()).nullable(),
      totalRows: z.number(),
      okRows: z.number(),
      errorRows: z.number(),
      hasErrorReport: z.boolean(),
    })
    .loose(),
})

const show = async (id: string, cookie = sellerCookie) =>
  getImport(request(`/seller/imports/${id}`, { cookie }), params(id))

describe('an import through the API', () => {
  test('upload an Excel file, choose the columns, and download the rows not imported', async () => {
    const asked = await requestUpload(
      request('/seller/imports/uploads', {
        method: 'POST',
        cookie: sellerCookie,
        body: { fileName: 'catalogue.xlsx', size: 5000 },
      }),
    )
    expect(asked.status).toBe(201)
    const { upload } = uploadResponse.parse(await asked.json())

    // The browser posts the file straight to object storage.
    const sku = `JB-${crypto.randomUUID().slice(0, 8)}`
    const body = new FormData()
    for (const [name, value] of Object.entries(upload.fields))
      body.append(name, value)
    body.append(
      'file',
      new Blob([
        createTestWorkbook([
          ['Name', 'Category', 'Code', 'Price', 'MRP', 'Stock'],
          ['Jute Shopping Bag', categoryName, sku, 349, 399, 25],
          ['Jute Tote', 'No Such Category', `${sku}-2`, 299, 349, 5],
        ]),
      ]),
    )
    expect((await fetch(upload.url, { method: 'POST', body })).status).toBe(204)

    const created = await create(
      request('/seller/imports', {
        method: 'POST',
        cookie: sellerCookie,
        body: { uploadKey: upload.key, fileName: 'catalogue.xlsx' },
      }),
    )
    expect(created.status).toBe(202)
    const { id } = importResponse.parse(await created.json()).import

    // What the worker does when it takes the job.
    await readImportFile(await jobs(), id, upload.key)
    const read = importResponse.parse(await (await show(id)).json()).import
    expect(read).toMatchObject({
      status: 'mapping_suggested',
      headers: ['Name', 'Category', 'Code', 'Price', 'MRP', 'Stock'],
      totalRows: 2,
      suggestionPending: false,
      suggestedMapping: {
        Name: { field: 'title', source: 'name' },
        Code: { field: 'sku', source: 'name' },
        Stock: { field: 'stock', source: 'name' },
      },
    })

    const map = (columnMapping: Record<string, string>) =>
      setMapping(
        request(`/seller/imports/${id}/mapping`, {
          method: 'PUT',
          cookie: sellerCookie,
          body: { columnMapping },
        }),
        params(id),
      )
    const incomplete = await map({ Name: 'title' })
    expect(incomplete.status).toBe(400)
    expect(await incomplete.json()).toEqual({
      error: 'That column mapping is not valid',
      issues: [
        'category needs a column',
        'sku needs a column',
        'price needs a column',
        'mrp needs a column',
        'stock needs a column',
      ],
    })
    const columnMapping = {
      Name: 'title',
      Category: 'category',
      Code: 'sku',
      Price: 'price',
      MRP: 'mrp',
      Stock: 'stock',
    }
    expect((await map(columnMapping)).status).toBe(202)
    expect((await map(columnMapping)).status).toBe(409)

    // What the worker does when it takes the job.
    await runImport(await jobs(), id)
    expect(
      importResponse.parse(await (await show(id)).json()).import,
    ).toMatchObject({
      status: 'completed',
      okRows: 1,
      errorRows: 1,
      hasErrorReport: true,
    })

    const listed = await list(
      request('/seller/imports', { cookie: sellerCookie }),
    )
    expect(
      z
        .object({ items: z.array(z.object({ id: z.string() }).loose()) })
        .parse(await listed.json())
        .items.map((item) => item.id),
    ).toContain(id)

    const report = await errorReport(
      request(`/seller/imports/${id}/error-report`, { cookie: sellerCookie }),
      params(id),
    )
    expect(report.status).toBe(302)
    expect(report.headers.get('cache-control')).toBe('no-store')
    const file = await fetch(report.headers.get('location')!)
    expect(file.status).toBe(200)
    const text = await file.text()
    expect(text).toContain(
      '"3","""Category"" ""No Such Category"" is not an EcoKart category","Jute Tote"',
    )
  })
})

describe('refusals', () => {
  test('401 signed out, 403 for a buyer, 404 for another seller', async () => {
    const signedOut = await list(request('/seller/imports'))
    expect(signedOut.status).toBe(401)
    const buyer = await list(
      request('/seller/imports', { cookie: buyerCookie }),
    )
    expect(buyer.status).toBe(403)

    const asked = await requestUpload(
      request('/seller/imports/uploads', {
        method: 'POST',
        cookie: sellerCookie,
        body: { fileName: 'products.csv', size: 100 },
      }),
    )
    const { upload } = uploadResponse.parse(await asked.json())
    const created = await create(
      request('/seller/imports', {
        method: 'POST',
        cookie: sellerCookie,
        body: { uploadKey: upload.key, fileName: 'products.csv' },
      }),
    )
    const { id } = importResponse.parse(await created.json()).import
    expect((await show(id, otherSellerCookie)).status).toBe(404)

    const tooBig = await requestUpload(
      request('/seller/imports/uploads', {
        method: 'POST',
        cookie: sellerCookie,
        body: { fileName: 'products.pdf', size: 1 },
      }),
    )
    expect(tooBig.status).toBe(400)
    expect(await tooBig.json()).toEqual({
      error: 'That file cannot be uploaded',
      issues: ['fileName must end with .csv or .xlsx'],
    })
  })
})
