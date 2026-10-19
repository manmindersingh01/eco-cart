import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { ZodError } from 'zod'
import { createDatabase, type Transaction } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import {
  auditLogs,
  invoices,
  orders,
  products,
  sellers,
} from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  NotSignedInError,
} from '../../errors.ts'
import { startJobQueue, type JobQueue } from '../../lib/queue.ts'
import { createObjectStorage, loadStorageConfig } from '../../lib/storage.ts'
import { validationIssues } from '../../testing/errors.ts'
import {
  createTestCategory,
  createTestInvoicingSeller,
  createTestOrderWithLines,
  createTestProduct,
  createTestUser,
  orderToInvoiceFor,
  type TestOrderLine,
} from '../../testing/fixtures.ts'
import { holdRows, sessionsWaitingOn, waitUntil } from '../../testing/locks.ts'
import { renderInvoice, storeInvoicePdf } from './jobs.ts'
import { financialYearOf } from './numbers.ts'
import {
  cancelInvoices,
  getInvoiceDownload,
  issueInvoices,
  listOrderInvoices,
  listOwnInvoices,
  readInvoiceDocument,
  RENDER_INVOICE_QUEUE,
  rerenderInvoice,
} from './service.ts'
import type { OrderToInvoice } from './types.ts'

/*
 * Issuing, numbering, and reading invoices (backend spec step 14), as the
 * web app does it: ecokart_web inside withContext. Fixtures are written as
 * the database owner.
 */

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'invoices-test')
  pools.push(pool)
  return createDatabase(pool)
}
const web = connect(requireEnv('DATABASE_URL'))
const worker = connect(requireEnv('WORKER_DATABASE_URL'))
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))
const storage = createObjectStorage(loadStorageConfig())
const system: RequestContext = { role: 'system' }
let queue: JobQueue
let categoryId: string
let admin: RequestContext

beforeAll(async () => {
  queue = await startJobQueue(requireEnv('DATABASE_URL'), 'invoices-test')
  categoryId = (await createTestCategory(owner)).id
  admin = { role: 'admin', userId: (await createTestUser(owner, 'admin')).id }
})

afterAll(async () => {
  await queue.stop()
  await Promise.all(pools.map((pool) => pool.end()))
})

/** This year's numbers, for example `/2627/` in 2026-27. */
const year = financialYearOf(new Date()).replace(
  /^\d{2}(\d{2})-(\d{2})$/,
  '$1$2',
)

const as = <T>(
  context: RequestContext,
  work: (tx: Transaction) => Promise<T>,
) => withContext(web, context, work)

/** Orders placed in these tests, with what step 12 will hand over for them. */
const placed = new Map<string, OrderToInvoice>()

async function placeOrder(
  options: Parameters<typeof createTestOrderWithLines>[1],
) {
  const created = await createTestOrderWithLines(owner, options)
  placed.set(created.order.id, orderToInvoiceFor(created.order, created.items))
  return created
}

/** Issues the invoices as payment confirmation will: under the order's lock. */
const issue = (orderId: string) =>
  as(system, async (tx) => {
    await tx
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for('update')
    return issueInvoices(tx, queue, placed.get(orderId)!)
  })

async function sellerWithProduct(stateCode = '27') {
  const { owner: user, seller } = await createTestInvoicingSeller(owner, {
    stateCode,
  })
  const { product, variant } = await createTestProduct(owner, {
    sellerId: seller.id,
    categoryId,
  })
  const context: RequestContext = {
    role: 'seller',
    userId: user.id,
    sellerId: seller.id,
  }
  const line = (changes: Partial<TestOrderLine> = {}): TestOrderLine => ({
    sellerId: seller.id,
    productId: product.id,
    variantId: variant.id,
    ...changes,
  })
  return { seller, context, line }
}

async function newBuyer() {
  const user = await createTestUser(owner, 'buyer')
  return { user, context: { role: 'buyer', userId: user.id } as const }
}

async function sequenceOf(sellerId: string) {
  const [row] = await owner
    .select({ seq: sellers.invoiceSeq, year: sellers.invoiceSeqFy })
    .from(sellers)
    .where(eq(sellers.id, sellerId))
  return row!
}

async function renderJobs(invoiceId: string): Promise<number> {
  const result = await owner.execute<{ count: number }>(
    sql`select count(*)::int as count from pgboss.job where name = ${RENDER_INVOICE_QUEUE} and data->>'invoiceId' = ${invoiceId}`,
  )
  return result.rows[0]!.count
}

async function rejection(attempt: Promise<unknown>): Promise<unknown> {
  return attempt.then(
    () => {
      throw new Error('Expected the call to fail')
    },
    (error: unknown) => error,
  )
}

describe('issueInvoices', () => {
  test('issues one invoice per seller, numbered from each seller’s own sequence', async () => {
    const pune = await sellerWithProduct('27')
    const bengaluru = await sellerWithProduct('29')
    const { user } = await newBuyer()
    const { order } = await placeOrder({
      buyerId: user.id,
      lines: [pune.line(), bengaluru.line(), pune.line({ quantity: 2 })],
    })

    const issued = await issue(order.id)
    expect(issued.map((invoice) => invoice.invoiceNumber).toSorted()).toEqual(
      [
        `${pune.seller.invoicePrefix}/${year}/000001`,
        `${bengaluru.seller.invoicePrefix}/${year}/000001`,
      ].toSorted(),
    )
    expect(await sequenceOf(pune.seller.id)).toEqual({
      seq: 1,
      year: financialYearOf(new Date()),
    })

    const next = await placeOrder({
      buyerId: user.id,
      lines: [pune.line()],
    })
    expect(await issue(next.order.id)).toMatchObject([
      { invoiceNumber: `${pune.seller.invoicePrefix}/${year}/000002` },
    ])
  })

  test('uses CGST and SGST within a state and IGST between states', async () => {
    const pune = await sellerWithProduct('27')
    const bengaluru = await sellerWithProduct('29')
    const { user } = await newBuyer()
    // ₹500 at 18% is ₹423.73 plus ₹76.27 of tax, an odd number of paise.
    const { order } = await placeOrder({
      buyerId: user.id,
      shippingStateCode: '27',
      lines: [pune.line(), bengaluru.line()],
    })
    const issued = await issue(order.id)
    const withinState = await readInvoiceDocument(
      owner,
      issued.find((invoice) => invoice.sellerId === pune.seller.id)!.id,
    )
    const betweenStates = await readInvoiceDocument(
      owner,
      issued.find((invoice) => invoice.sellerId === bengaluru.seller.id)!.id,
    )
    expect(withinState).toMatchObject({
      placeOfSupplyStateCode: '27',
      isInterstate: false,
      taxablePaise: 42_373,
      cgstPaise: 3_813,
      sgstPaise: 3_814,
      igstPaise: 0,
      totalPaise: 50_000,
    })
    expect(betweenStates).toMatchObject({
      placeOfSupplyStateCode: '27',
      isInterstate: true,
      taxablePaise: 42_373,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 7_627,
      totalPaise: 50_000,
    })
  })

  test('freezes what the invoice prints, so later edits never change it', async () => {
    const pune = await sellerWithProduct('27')
    const { user } = await newBuyer()
    const { order, items } = await placeOrder({
      buyerId: user.id,
      paymentMethod: 'cod',
      shippingStateCode: '29',
      lines: [
        pune.line({
          title: 'Steel Bottle, 750 ml',
          options: { Colour: 'Silver' },
          hsnCode: '7323',
          gstRateBps: 1800,
          unitPricePaise: 50_000,
          quantity: 2,
          discountSharePaise: 10_000,
        }),
      ],
    })
    const [issued] = await issue(order.id)

    // The seller and the product change after the sale.
    await owner
      .update(sellers)
      .set({ legalName: 'Renamed Private Limited', city: 'Mumbai' })
      .where(eq(sellers.id, pune.seller.id))
    await owner
      .update(products)
      .set({ title: 'A new title' })
      .where(eq(products.id, items[0]!.productId))

    const invoice = await readInvoiceDocument(owner, issued!.id)
    expect(invoice).toMatchObject({
      sellerId: pune.seller.id,
      seller: {
        legalName: pune.seller.legalName,
        displayName: pune.seller.displayName,
        gstin: '27AAACE1234F1Z5',
        address: {
          line1: '12 MG Road',
          city: 'Pune',
          stateCode: '27',
          stateName: 'Maharashtra',
          pincode: '411001',
        },
        supportEmail: pune.seller.supportEmail,
        supportPhone: '+919800000000',
      },
      buyer: {
        userId: user.id,
        name: 'Asha Patil',
        shippingAddress: {
          fullName: 'Asha Patil',
          line1: '4 FC Road',
          line2: 'Shivajinagar',
          landmark: null,
          city: 'Pune',
          stateCode: '29',
          stateName: 'Karnataka',
          pincode: '411004',
        },
        orderNumber: order.orderNumber,
        orderPlacedAt: order.placedAt.toISOString(),
        paymentMethod: 'cod',
      },
      lines: [
        {
          orderItemId: items[0]!.id,
          title: 'Steel Bottle, 750 ml',
          options: { Colour: 'Silver' },
          sku: items[0]!.sku,
          hsnCode: '7323',
          quantity: 2,
          unitPricePaise: 50_000,
          grossPaise: 1_00_000,
          discountPaise: 10_000,
          taxablePaise: 76_271,
          gstRateBps: 1800,
          cgstPaise: 0,
          sgstPaise: 0,
          igstPaise: 13_729,
          totalPaise: 90_000,
        },
      ],
    })
    // The buyer's phone and email are not part of the invoice.
    expect(JSON.stringify(invoice!.buyer)).not.toContain('+919800000001')
    expect(JSON.stringify(invoice!.buyer)).not.toContain('asha@example.test')
  })

  test('queues the PDF in the same transaction, and a rollback gives the number back', async () => {
    const pune = await sellerWithProduct()
    const { user } = await newBuyer()
    const { order } = await placeOrder({
      buyerId: user.id,
      lines: [pune.line()],
    })

    const failed = await rejection(
      as(system, async (tx) => {
        await issueInvoices(tx, queue, placed.get(order.id)!)
        throw new Error('The confirmation failed later')
      }),
    )
    expect(String(failed)).toContain('The confirmation failed later')
    expect(await sequenceOf(pune.seller.id)).toMatchObject({ seq: 0 })
    expect(
      await owner.select().from(invoices).where(eq(invoices.orderId, order.id)),
    ).toEqual([])

    const [issued] = await issue(order.id)
    expect(issued!.invoiceNumber).toBe(
      `${pune.seller.invoicePrefix}/${year}/000001`,
    )
    expect(await renderJobs(issued!.id)).toBe(1)
  })

  test('issues nothing new when called again for the same order', async () => {
    const pune = await sellerWithProduct()
    const bengaluru = await sellerWithProduct('29')
    const { user } = await newBuyer()
    const { order } = await placeOrder({
      buyerId: user.id,
      lines: [pune.line(), bengaluru.line()],
    })
    const first = await issue(order.id)
    const again = await issue(order.id)
    expect(again.toSorted((a, b) => a.id.localeCompare(b.id))).toEqual(
      first.toSorted((a, b) => a.id.localeCompare(b.id)),
    )
    expect(await sequenceOf(pune.seller.id)).toMatchObject({ seq: 1 })
    for (const invoice of first) expect(await renderJobs(invoice.id)).toBe(1)
  })

  test('invoices only the lines it is given: none for a seller whose lines were cancelled', async () => {
    const pune = await sellerWithProduct()
    const bengaluru = await sellerWithProduct('29')
    const { user } = await newBuyer()
    const { order } = await placeOrder({
      buyerId: user.id,
      lines: [
        pune.line({ status: 'cancelled' }),
        bengaluru.line({ unitPricePaise: 30_000 }),
        bengaluru.line({ status: 'cancelled' }),
      ],
    })
    const issued = await issue(order.id)
    expect(issued).toMatchObject([{ sellerId: bengaluru.seller.id }])
    const invoice = await readInvoiceDocument(owner, issued[0]!.id)
    expect(invoice!.lines).toHaveLength(1)
    expect(invoice!.totalPaise).toBe(30_000)
    expect(await sequenceOf(pune.seller.id)).toMatchObject({ seq: 0 })
  })

  test('only in a system transaction, and only for a whole order', async () => {
    const pune = await sellerWithProduct()
    const { user, context } = await newBuyer()
    const { order } = await placeOrder({
      buyerId: user.id,
      lines: [pune.line()],
    })
    const input = placed.get(order.id)!
    expect(
      String(
        await rejection(as(context, (tx) => issueInvoices(tx, queue, input))),
      ),
    ).toContain('only in a system transaction')
    // A mistake in the caller fails loudly instead of printing a bad invoice.
    expect(
      await rejection(
        as(system, (tx) => issueInvoices(tx, queue, { ...input, lines: [] })),
      ),
    ).toBeInstanceOf(ZodError)
    expect(await sequenceOf(pune.seller.id)).toMatchObject({ seq: 0 })
    expect(await issue(order.id)).toHaveLength(1)
  })
})

describe('the yearly sequence', () => {
  test('starts again at 1 in a new financial year', async () => {
    const pune = await sellerWithProduct()
    await owner
      .update(sellers)
      .set({ invoiceSeq: 5_731, invoiceSeqFy: '2025-26' })
      .where(eq(sellers.id, pune.seller.id))
    const { user } = await newBuyer()
    const { order } = await placeOrder({
      buyerId: user.id,
      lines: [pune.line()],
    })
    expect(await issue(order.id)).toMatchObject([
      { invoiceNumber: `${pune.seller.invoicePrefix}/${year}/000001` },
    ])
    expect(await sequenceOf(pune.seller.id)).toEqual({
      seq: 1,
      year: financialYearOf(new Date()),
    })
  })

  test('never moves back to an earlier year', async () => {
    const pune = await sellerWithProduct()
    // As if a confirmation dated in the next year took a number first.
    await owner
      .update(sellers)
      .set({ invoiceSeq: 3, invoiceSeqFy: '2099-00' })
      .where(eq(sellers.id, pune.seller.id))
    const { user } = await newBuyer()
    const { order } = await placeOrder({
      buyerId: user.id,
      lines: [pune.line()],
    })
    const error = await rejection(issue(order.id))
    expect(error).toBeInstanceOf(ConflictError)
    expect(String(error)).toContain('moved on to 2099-00')
    expect(await sequenceOf(pune.seller.id)).toEqual({
      seq: 3,
      year: '2099-00',
    })
  })
})

describe('confirmations at the same moment', () => {
  test('two orders for one seller get consecutive numbers', async () => {
    const pune = await sellerWithProduct()
    const { user } = await newBuyer()
    const first = await placeOrder({
      buyerId: user.id,
      lines: [pune.line()],
    })
    const second = await placeOrder({
      buyerId: user.id,
      lines: [pune.line()],
    })

    const held = await holdRows(owner, sellers, sellers.id, [pune.seller.id])
    const racing = [issue(first.order.id), issue(second.order.id)]
    await waitUntil(async () => (await sessionsWaitingOn(owner, held.pid)) >= 2)
    held.release()
    await held.finished
    const numbers = (await Promise.all(racing))
      .flat()
      .map((i) => i.invoiceNumber)

    expect(numbers.toSorted()).toEqual([
      `${pune.seller.invoicePrefix}/${year}/000001`,
      `${pune.seller.invoicePrefix}/${year}/000002`,
    ])
    expect(await sequenceOf(pune.seller.id)).toMatchObject({ seq: 2 })
  })

  test('two confirmations of the same order make one set of invoices', async () => {
    const pune = await sellerWithProduct()
    const { user } = await newBuyer()
    const { order } = await placeOrder({
      buyerId: user.id,
      lines: [pune.line()],
    })

    const held = await holdRows(owner, orders, orders.id, [order.id])
    const racing = [issue(order.id), issue(order.id)]
    await waitUntil(async () => (await sessionsWaitingOn(owner, held.pid)) >= 2)
    held.release()
    await held.finished
    const [first, second] = await Promise.all(racing)

    expect(second).toEqual(first)
    expect(
      await owner.select().from(invoices).where(eq(invoices.orderId, order.id)),
    ).toHaveLength(1)
    expect(await sequenceOf(pune.seller.id)).toMatchObject({ seq: 1 })
  })

  test('without the order’s lock, a second confirmation is refused, not numbered twice', async () => {
    const pune = await sellerWithProduct()
    const { user } = await newBuyer()
    const { order } = await placeOrder({
      buyerId: user.id,
      lines: [pune.line()],
    })
    const input = placed.get(order.id)!

    // Both find no invoice yet, then queue for the seller's sequence.
    const held = await holdRows(owner, sellers, sellers.id, [pune.seller.id])
    const racing = [1, 2].map(() =>
      as(system, (tx) => issueInvoices(tx, queue, input)).then(
        () => 'issued',
        (error: unknown) => error,
      ),
    )
    await waitUntil(async () => (await sessionsWaitingOn(owner, held.pid)) >= 2)
    held.release()
    await held.finished
    const outcomes = await Promise.all(racing)

    expect(outcomes.filter((outcome) => outcome === 'issued')).toHaveLength(1)
    expect(outcomes.find((outcome) => outcome !== 'issued')).toBeInstanceOf(
      ConflictError,
    )
    expect(await sequenceOf(pune.seller.id)).toMatchObject({ seq: 1 })
  })

  test('two orders sharing two sellers never deadlock', async () => {
    const a = await sellerWithProduct()
    const b = await sellerWithProduct()
    const { user } = await newBuyer()
    // The lines come in opposite orders; the sellers are locked by id.
    const first = await placeOrder({
      buyerId: user.id,
      lines: [a.line(), b.line()],
    })
    const second = await placeOrder({
      buyerId: user.id,
      lines: [b.line(), a.line()],
    })

    const held = await holdRows(owner, sellers, sellers.id, [
      a.seller.id,
      b.seller.id,
    ])
    const racing = [issue(first.order.id), issue(second.order.id)]
    await waitUntil(async () => (await sessionsWaitingOn(owner, held.pid)) >= 2)
    held.release()
    await held.finished
    const issued = (await Promise.all(racing)).flat()

    expect(issued).toHaveLength(4)
    expect(await sequenceOf(a.seller.id)).toMatchObject({ seq: 2 })
    expect(await sequenceOf(b.seller.id)).toMatchObject({ seq: 2 })
  })
})

describe('who sees an invoice', () => {
  let buyer: Awaited<ReturnType<typeof newBuyer>>
  let pune: Awaited<ReturnType<typeof sellerWithProduct>>
  let bengaluru: Awaited<ReturnType<typeof sellerWithProduct>>
  let orderId: string
  let puneInvoiceId: string

  beforeAll(async () => {
    buyer = await newBuyer()
    pune = await sellerWithProduct('27')
    bengaluru = await sellerWithProduct('29')
    const { order } = await placeOrder({
      buyerId: buyer.user.id,
      lines: [pune.line(), bengaluru.line()],
    })
    orderId = order.id
    const issued = await issue(order.id)
    puneInvoiceId = issued.find((i) => i.sellerId === pune.seller.id)!.id
  })

  test('the buyer and administrators list every invoice of the order', async () => {
    for (const context of [buyer.context, admin]) {
      const listed = await as(context, (tx) =>
        listOrderInvoices(tx, context, orderId),
      )
      expect(listed.map((invoice) => invoice.sellerId).toSorted()).toEqual(
        [pune.seller.id, bengaluru.seller.id].toSorted(),
      )
    }
    const [summary] = await as(buyer.context, (tx) =>
      listOrderInvoices(tx, buyer.context, orderId),
    )
    expect(summary).toMatchObject({
      orderId,
      orderNumber: expect.stringMatching(/^EK-TEST-/),
      buyerName: 'Asha Patil',
      totalPaise: 50_000,
      pdfReady: false,
    })
  })

  test('a seller lists only their own invoice', async () => {
    const listed = await as(pune.context, (tx) =>
      listOrderInvoices(tx, pune.context, orderId),
    )
    expect(listed).toMatchObject([
      {
        id: puneInvoiceId,
        sellerId: pune.seller.id,
        sellerName: pune.seller.legalName,
      },
    ])
  })

  test('anyone else gets an empty list', async () => {
    const stranger = await newBuyer()
    const outsider = await sellerWithProduct()
    for (const context of [stranger.context, outsider.context]) {
      expect(
        await as(context, (tx) => listOrderInvoices(tx, context, orderId)),
      ).toEqual([])
    }
    expect(
      await as(buyer.context, (tx) =>
        listOrderInvoices(tx, buyer.context, 'not-an-id'),
      ),
    ).toEqual([])
    const visitor: RequestContext = { role: 'anonymous' }
    expect(
      await rejection(
        as(visitor, (tx) => listOrderInvoices(tx, visitor, orderId)),
      ),
    ).toBeInstanceOf(NotSignedInError)
  })

  test('the download waits for the PDF, then links to it for five minutes', async () => {
    const services = { db: web, storage }
    expect(
      await rejection(
        getInvoiceDownload(services, buyer.context, puneInvoiceId),
      ),
    ).toBeInstanceOf(ConflictError)

    await renderInvoice({ db: worker, storage }, puneInvoiceId)
    const [invoice] = await owner
      .select()
      .from(invoices)
      .where(eq(invoices.id, puneInvoiceId))
    for (const context of [buyer.context, pune.context, admin]) {
      const before = Date.now()
      const download = await getInvoiceDownload(
        services,
        context,
        puneInvoiceId,
      )
      expect(download.fileName).toBe(
        `${invoice!.invoiceNumber.replaceAll('/', '-')}.pdf`,
      )
      expect(download.expiresAt.getTime() - before).toBeGreaterThanOrEqual(
        5 * 60 * 1000,
      )
      expect(download.expiresAt.getTime() - before).toBeLessThan(
        5 * 60 * 1000 + 5000,
      )
      const response = await fetch(download.url)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('application/pdf')
      expect(Buffer.from(await response.arrayBuffer()).subarray(0, 5)).toEqual(
        Buffer.from('%PDF-'),
      )
    }
  })

  test('the download is not found for anyone else', async () => {
    const stranger = await newBuyer()
    for (const context of [stranger.context, bengaluru.context]) {
      expect(
        await rejection(
          getInvoiceDownload({ db: web, storage }, context, puneInvoiceId),
        ),
      ).toBeInstanceOf(NotFoundError)
    }
    expect(
      await rejection(
        getInvoiceDownload({ db: web, storage }, buyer.context, 'not-an-id'),
      ),
    ).toBeInstanceOf(NotFoundError)
  })

  test('administrators have the PDF made again, with an audit entry', async () => {
    const summary = await as(admin, (tx) =>
      rerenderInvoice(tx, queue, admin, puneInvoiceId),
    )
    expect(summary.id).toBe(puneInvoiceId)
    expect(await renderJobs(puneInvoiceId)).toBe(2)
    const [entry] = await owner
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, puneInvoiceId))
    expect(entry).toMatchObject({
      action: 'invoice.render',
      entityType: 'invoice',
      actorRole: 'admin',
      after: { invoiceNumber: summary.invoiceNumber },
    })

    for (const context of [buyer.context, pune.context]) {
      expect(
        await rejection(
          as(context, (tx) =>
            rerenderInvoice(tx, queue, context, puneInvoiceId),
          ),
        ),
      ).toBeInstanceOf(ForbiddenError)
    }
  })
})

describe('a seller’s invoice list', () => {
  test('pages through their own invoices, newest first', async () => {
    const pune = await sellerWithProduct()
    const other = await sellerWithProduct()
    const { user, context } = await newBuyer()
    for (let index = 0; index < 3; index++) {
      const { order } = await placeOrder({
        buyerId: user.id,
        lines: [pune.line(), other.line()],
      })
      await issue(order.id)
    }

    const first = await as(pune.context, (tx) =>
      listOwnInvoices(tx, pune.context, { limit: 2 }),
    )
    expect(first.items.map((invoice) => invoice.invoiceNumber)).toEqual([
      `${pune.seller.invoicePrefix}/${year}/000003`,
      `${pune.seller.invoicePrefix}/${year}/000002`,
    ])
    const second = await as(pune.context, (tx) =>
      listOwnInvoices(tx, pune.context, {
        limit: 2,
        cursor: first.nextCursor!,
      }),
    )
    expect(second.items.map((invoice) => invoice.invoiceNumber)).toEqual([
      `${pune.seller.invoicePrefix}/${year}/000001`,
    ])
    expect(second.nextCursor).toBeNull()

    expect(
      await rejection(as(context, (tx) => listOwnInvoices(tx, context))),
    ).toBeInstanceOf(ForbiddenError)
  })
})

/** Cancels the order's invoices as step 13 will: under the order's lock. */
const cancel = (orderId: string, reason = 'Cancelled by the buyer') =>
  as(system, async (tx) => {
    await tx
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for('update')
    return cancelInvoices(tx, queue, { orderId, reason })
  })

async function invoicedOrder() {
  const pune = await sellerWithProduct('27')
  const bengaluru = await sellerWithProduct('29')
  const buyer = await newBuyer()
  const { order } = await placeOrder({
    buyerId: buyer.user.id,
    lines: [pune.line(), bengaluru.line()],
  })
  const issued = await issue(order.id)
  for (const invoice of issued) {
    await renderInvoice({ db: worker, storage }, invoice.id)
  }
  return { pune, buyer, order, issued }
}

const rowsOf = (orderId: string) =>
  owner
    .select()
    .from(invoices)
    .where(eq(invoices.orderId, orderId))
    .orderBy(invoices.invoiceNumber)

describe('cancelInvoices', () => {
  test('cancels every invoice of the order, keeps its number, and makes its PDF again', async () => {
    const { pune, buyer, order, issued } = await invoicedOrder()
    const before = await rowsOf(order.id)

    const cancelled = await cancel(
      order.id,
      'Cancelled by the buyer before dispatch',
    )
    expect(cancelled.map((invoice) => invoice.id).toSorted()).toEqual(
      issued.map((invoice) => invoice.id).toSorted(),
    )
    const after = await rowsOf(order.id)
    for (const [index, row] of after.entries()) {
      expect(row).toMatchObject({
        invoiceNumber: before[index]!.invoiceNumber,
        cancelReason: 'Cancelled by the buyer before dispatch',
        cancelledAt: expect.any(Date),
        pdfStorageKey: null,
      })
      expect(await renderJobs(row.id)).toBe(2)
    }
    expect(await sequenceOf(pune.seller.id)).toMatchObject({ seq: 1 })

    // The old PDF cannot be downloaded while the cancelled one is made.
    const puneInvoice = issued.find((i) => i.sellerId === pune.seller.id)!
    expect(
      await rejection(
        getInvoiceDownload({ db: web, storage }, buyer.context, puneInvoice.id),
      ),
    ).toBeInstanceOf(ConflictError)
    await renderInvoice({ db: worker, storage }, puneInvoice.id)
    const [row] = await owner
      .select({ key: invoices.pdfStorageKey })
      .from(invoices)
      .where(eq(invoices.id, puneInvoice.id))
    expect(row!.key).toBe(
      `invoices/${pune.seller.id}/${puneInvoice.id}-cancelled.pdf`,
    )
    const download = await getInvoiceDownload(
      { db: web, storage },
      buyer.context,
      puneInvoice.id,
    )
    expect((await fetch(download.url)).status).toBe(200)

    const [summary] = await as(pune.context, (tx) =>
      listOrderInvoices(tx, pune.context, order.id),
    )
    expect(summary).toMatchObject({
      cancelledAt: expect.any(Date),
      cancelReason: 'Cancelled by the buyer before dispatch',
      pdfReady: true,
    })
  })

  test('changes nothing when called again, and the order is never invoiced again', async () => {
    const { pune, order, issued } = await invoicedOrder()
    await cancel(order.id, 'First reason')
    const first = await rowsOf(order.id)

    expect(await cancel(order.id, 'Second reason')).toEqual([])
    expect(await rowsOf(order.id)).toEqual(first)
    for (const invoice of issued) expect(await renderJobs(invoice.id)).toBe(2)

    // A replayed confirmation finds the cancelled invoices and issues nothing.
    expect(
      (await issue(order.id)).map((invoice) => invoice.id).toSorted(),
    ).toEqual(issued.map((invoice) => invoice.id).toSorted())
    expect(await sequenceOf(pune.seller.id)).toMatchObject({ seq: 1 })
  })

  test('needs a reason, an order id, and a system transaction', async () => {
    const { buyer, order } = await invoicedOrder()
    expect(
      await validationIssues(
        as(system, (tx) =>
          cancelInvoices(tx, queue, { orderId: order.id, reason: ' ' }),
        ),
      ),
    ).toEqual(['reason must not be empty'])
    expect(
      await validationIssues(
        as(system, (tx) =>
          cancelInvoices(tx, queue, { orderId: 'not-an-id', reason: 'x' }),
        ),
      ),
    ).toEqual(['orderId must be an order id'])
    expect(
      String(
        await rejection(
          as(buyer.context, (tx) =>
            cancelInvoices(tx, queue, { orderId: order.id, reason: 'x' }),
          ),
        ),
      ),
    ).toContain('only in a system transaction')
    expect((await rowsOf(order.id)).every((row) => !row.cancelledAt)).toBe(true)
  })

  test('a PDF made just before the cancellation never replaces the cancelled one', async () => {
    const { order, issued } = await invoicedOrder()
    const invoiceId = issued[0]!.id
    // A job read the invoice, then the order was cancelled while it worked.
    const stale = (await readInvoiceDocument(worker, invoiceId))!
    await cancel(order.id)
    await storeInvoicePdf({ db: worker, storage }, stale)
    const keyOf = async () =>
      (
        await owner
          .select({ key: invoices.pdfStorageKey })
          .from(invoices)
          .where(eq(invoices.id, invoiceId))
      )[0]!.key
    expect(await keyOf()).toBeNull()

    await renderInvoice({ db: worker, storage }, invoiceId)
    expect(await keyOf()).toMatch(/-cancelled\.pdf$/)
  })
})
