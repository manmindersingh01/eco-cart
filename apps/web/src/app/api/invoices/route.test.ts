import {
  createAccountDirectory,
  createDatabase,
  createObjectStorage,
  createPool,
  issueInvoices,
  loadStorageConfig,
  requireEnv,
  schema,
  withContext,
} from '@ecokart/core'
import {
  createTestCategory,
  createTestInvoicingSeller,
  createTestOrderWithLines,
  createTestProduct,
  createTestUser,
  orderToInvoiceFor,
} from '@ecokart/core/testing'
import { renderInvoice } from '@ecokart/core/worker'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { POST as render } from '@/app/api/admin/invoices/[id]/render/route'
import { GET as sellerInvoices } from '@/app/api/seller/invoices/route'
import { closePool, getDatabase } from '@/lib/db'
import { getAuth } from '@/lib/auth'
import { closeJobQueue, getJobQueue } from '@/lib/queue'
import { apiRequest as request, withId } from '@/testing/requests'
import { signInWithEmail } from '@/testing/sign-in'
import { GET as pdf } from './[id]/pdf/route'
import { GET as list } from './route'

/*
 * The invoice API (backend spec step 14). Invoices are issued the way
 * payment confirmation will issue them (step 12), and the PDF is made by the
 * worker's job, called directly.
 */

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'invoices-route-test',
)
const owner = createDatabase(ownerPool)
const storage = createObjectStorage(loadStorageConfig())

let buyerCookie: string
let otherBuyerCookie: string
let puneCookie: string
let bengaluruCookie: string
let adminCookie: string
let orderId: string
let puneInvoiceId: string

async function signedInBuyer() {
  const email = `${crypto.randomUUID()}@example.test`
  const cookie = await signInWithEmail(owner, email)
  const [user] = await owner
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
  return { cookie, id: user!.id }
}

beforeAll(async () => {
  const category = await createTestCategory(owner)
  const sellerIn = async (stateCode: string) => {
    const { owner: user, seller } = await createTestInvoicingSeller(owner, {
      stateCode,
    })
    const { product, variant } = await createTestProduct(owner, {
      sellerId: seller.id,
      categoryId: category.id,
    })
    return {
      seller,
      cookie: await signInWithEmail(owner, user.email),
      line: {
        sellerId: seller.id,
        productId: product.id,
        variantId: variant.id,
      },
    }
  }
  const [pune, bengaluru, buyer, otherBuyer, admin] = await Promise.all([
    sellerIn('27'),
    sellerIn('29'),
    signedInBuyer(),
    signedInBuyer(),
    createTestUser(owner, 'admin'),
  ])
  puneCookie = pune.cookie
  bengaluruCookie = bengaluru.cookie
  buyerCookie = buyer.cookie
  otherBuyerCookie = otherBuyer.cookie
  adminCookie = await signInWithEmail(owner, admin.email)

  const { order, items } = await createTestOrderWithLines(owner, {
    buyerId: buyer.id,
    lines: [pune.line, bengaluru.line],
  })
  orderId = order.id
  const queue = await getJobQueue()
  const issued = await withContext(getDatabase(), { role: 'system' }, (tx) =>
    issueInvoices(tx, queue, orderToInvoiceFor(order, items)),
  )
  puneInvoiceId = issued.find((i) => i.sellerId === pune.seller.id)!.id
})

afterAll(async () => {
  await closeJobQueue()
  await closePool()
  await ownerPool.end()
})

const invoiceList = z.object({
  invoices: z.array(
    z
      .object({
        id: z.string(),
        invoiceNumber: z.string(),
        sellerId: z.string(),
        pdfReady: z.boolean(),
      })
      .loose(),
  ),
})

const listFor = (cookie?: string, query = `?orderId=${orderId}`) =>
  list(request(`/invoices${query}`, cookie ? { cookie } : {}))

const pdfFor = (cookie?: string, id = puneInvoiceId) =>
  pdf(request(`/invoices/${id}/pdf`, cookie ? { cookie } : {}), withId(id))

describe('GET /api/invoices?orderId=', () => {
  test('the buyer gets every seller’s invoice for their order', async () => {
    const response = await listFor(buyerCookie)
    expect(response.status).toBe(200)
    const { invoices } = invoiceList.parse(await response.json())
    expect(invoices).toHaveLength(2)
    expect(invoices.every((invoice) => !invoice.pdfReady)).toBe(true)
  })

  test('a seller gets only their own; an administrator gets all', async () => {
    const forSeller = invoiceList.parse(
      await (await listFor(puneCookie)).json(),
    )
    expect(forSeller.invoices.map((invoice) => invoice.id)).toEqual([
      puneInvoiceId,
    ])
    const forAdmin = invoiceList.parse(
      await (await listFor(adminCookie)).json(),
    )
    expect(forAdmin.invoices).toHaveLength(2)
  })

  test('401 signed out, 400 without an order, nothing for someone else’s order', async () => {
    expect((await listFor()).status).toBe(401)
    const missing = await listFor(buyerCookie, '')
    expect(missing.status).toBe(400)
    expect(await missing.json()).toEqual({
      error: 'orderId is required',
      issues: [],
    })
    const other = await listFor(otherBuyerCookie)
    expect(other.status).toBe(200)
    expect(await other.json()).toEqual({ invoices: [] })
  })
})

describe('GET /api/invoices/{id}/pdf', () => {
  test('I05 a combined account explicitly selects seller access for its sale invoice', async () => {
    const { owner: sellerUser, seller } = await createTestInvoicingSeller(owner)
    await createAccountDirectory(getAuth()).addRole(sellerUser.id, 'buyer')
    const cookie = await signInWithEmail(owner, sellerUser.email)
    const category = await createTestCategory(owner)
    const { product, variant } = await createTestProduct(owner, {
      sellerId: seller.id,
      categoryId: category.id,
    })
    const buyer = await signedInBuyer()
    const { order, items } = await createTestOrderWithLines(owner, {
      buyerId: buyer.id,
      lines: [
        { sellerId: seller.id, productId: product.id, variantId: variant.id },
      ],
    })
    const queue = await getJobQueue()
    const issued = await withContext(getDatabase(), { role: 'system' }, (tx) =>
      issueInvoices(tx, queue, orderToInvoiceFor(order, items)),
    )
    const invoiceId = issued[0]!.id
    await renderInvoice({ db: owner, storage }, invoiceId)
    expect(
      (
        await pdf(
          request(`/invoices/${invoiceId}/pdf`, { cookie }),
          withId(invoiceId),
        )
      ).status,
    ).toBe(404)
    expect(
      (
        await pdf(
          request(`/invoices/${invoiceId}/pdf?as=seller`, { cookie }),
          withId(invoiceId),
        )
      ).status,
    ).toBe(302)
    expect(
      (
        await pdf(
          request(`/invoices/${invoiceId}/pdf?as=seller`, {
            cookie: bengaluruCookie,
          }),
          withId(invoiceId),
        )
      ).status,
    ).toBe(404)
    expect(
      (
        await pdf(
          request(`/invoices/${invoiceId}/pdf`, { cookie: buyer.cookie }),
          withId(invoiceId),
        )
      ).status,
    ).toBe(302)
  })
  test('409 until the worker has made the PDF', async () => {
    const response = await pdfFor(buyerCookie)
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'The invoice PDF is still being made; try again in a minute',
    })
  })

  test('then redirects the buyer, the seller, and administrators to a signed link', async () => {
    await renderInvoice({ db: owner, storage }, puneInvoiceId)
    for (const cookie of [buyerCookie, puneCookie, adminCookie]) {
      const response = await pdfFor(cookie)
      expect(response.status).toBe(302)
      expect(response.headers.get('cache-control')).toBe('no-store')
      const file = await fetch(response.headers.get('location')!)
      expect(file.status).toBe(200)
      expect(file.headers.get('content-type')).toBe('application/pdf')
      expect(file.headers.get('content-disposition')).toMatch(
        /^attachment; filename="[A-Z0-9]{4}-\d{4}-000001\.pdf"/,
      )
      expect(Buffer.from(await file.arrayBuffer()).subarray(0, 5)).toEqual(
        Buffer.from('%PDF-'),
      )
    }
    const { invoices } = invoiceList.parse(
      await (await listFor(buyerCookie)).json(),
    )
    expect(
      invoices.find((invoice) => invoice.id === puneInvoiceId)?.pdfReady,
    ).toBe(true)
  })

  test('404 for another buyer, another seller, or an unknown invoice; 401 signed out', async () => {
    for (const cookie of [otherBuyerCookie, bengaluruCookie]) {
      const response = await pdfFor(cookie)
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({
        error: 'There is no invoice with that id',
      })
    }
    expect((await pdfFor(buyerCookie, crypto.randomUUID())).status).toBe(404)
    expect((await pdfFor(buyerCookie, 'not-an-id')).status).toBe(404)
    expect((await pdfFor()).status).toBe(401)
  })
})

describe('GET /api/seller/invoices', () => {
  const page = z.object({
    items: z.array(z.object({ invoiceNumber: z.string() }).loose()),
    nextCursor: z.string().nullable(),
  })

  test('the seller pages through their own invoices', async () => {
    const response = await sellerInvoices(
      request('/seller/invoices?limit=10', { cookie: puneCookie }),
    )
    expect(response.status).toBe(200)
    const { items, nextCursor } = page.parse(await response.json())
    expect(items).toHaveLength(1)
    expect(nextCursor).toBeNull()
  })

  test('403 for a buyer, 401 signed out, 400 for a bad cursor', async () => {
    expect(
      (
        await sellerInvoices(
          request('/seller/invoices', { cookie: buyerCookie }),
        )
      ).status,
    ).toBe(403)
    expect((await sellerInvoices(request('/seller/invoices'))).status).toBe(401)
    expect(
      (
        await sellerInvoices(
          request('/seller/invoices?cursor=nonsense', { cookie: puneCookie }),
        )
      ).status,
    ).toBe(400)
  })
})

const renderAs = (cookie?: string, id = puneInvoiceId) =>
  render(
    request(`/admin/invoices/${id}/render`, {
      method: 'POST',
      ...(cookie ? { cookie } : {}),
    }),
    withId(id),
  )

describe('POST /api/admin/invoices/{id}/render', () => {
  test('an administrator has the PDF made again', async () => {
    const response = await renderAs(adminCookie)
    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({
      invoice: { id: puneInvoiceId },
    })
  })

  test('403 for a seller or buyer, 404 for an unknown invoice, 401 signed out', async () => {
    expect((await renderAs(puneCookie)).status).toBe(403)
    expect((await renderAs(buyerCookie)).status).toBe(403)
    expect((await renderAs(adminCookie, crypto.randomUUID())).status).toBe(404)
    expect((await renderAs()).status).toBe(401)
  })
})
