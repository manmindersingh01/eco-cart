import { randomUUID } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDatabase, type Transaction } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import {
  auditLogs,
  coupons,
  emailOutbox,
  invoices,
  orderEvents,
  orderItems,
  orders,
  payments,
  productVariants,
  sellerLedgerEntries,
} from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../errors.ts'
import { startJobQueue, type JobQueue } from '../../lib/queue.ts'
import { createRazorpay, type Razorpay } from '../../lib/razorpay.ts'
import {
  createTestAddress,
  createTestCategory,
  createTestCoupon,
  createTestInvoicingSeller,
  createTestProduct,
  createTestUser,
  saveTestSettings,
} from '../../testing/fixtures.ts'
import { holdRows, sessionsWaitingOn, waitUntil } from '../../testing/locks.ts'
import { startFakeRazorpay, type FakeRazorpay } from '../../testing/razorpay.ts'
import { addCartItem, applyCoupon } from '../cart/service.ts'
import { placeOrder } from '../checkout/service.ts'
import { handleRazorpayWebhook } from '../payments/service.ts'
import {
  cancelOrderAsAdmin,
  cancelOwnOrder,
  dispatchLines,
  markShipmentDelivered,
} from './fulfilment.ts'
import {
  findVerifiedPurchase,
  getAdminOrder,
  getBuyerOrder,
  getSellerOrder,
  listAdminOrders,
  listBuyerOrders,
  listSellerOrders,
} from './views.ts'

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'orders-test')
  pools.push(pool)
  return createDatabase(pool)
}
const web = connect(requireEnv('DATABASE_URL'))
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))
const photos = { publicUrl: (key: string) => `https://cdn.test/${key}` }

type Buyer = Extract<RequestContext, { role: 'buyer' }>
type Seller = Extract<RequestContext, { role: 'seller' }>
type Admin = Extract<RequestContext, { role: 'admin' }>

let queue: JobQueue
let fake: FakeRazorpay
let razorpay: Razorpay
let categoryId: string
let pune: Seller
let bengaluru: Seller
let admin: Admin

beforeAll(async () => {
  await saveTestSettings(owner)
  queue = await startJobQueue(requireEnv('DATABASE_URL'), 'orders-test')
  fake = await startFakeRazorpay()
  razorpay = createRazorpay(fake.config)
  const [first, second, category, administrator] = await Promise.all([
    createTestInvoicingSeller(owner, { stateCode: '27' }),
    createTestInvoicingSeller(owner, { stateCode: '29' }),
    createTestCategory(owner),
    createTestUser(owner, 'admin'),
  ])
  pune = { role: 'seller', userId: first.owner.id, sellerId: first.seller.id }
  bengaluru = {
    role: 'seller',
    userId: second.owner.id,
    sellerId: second.seller.id,
  }
  categoryId = category.id
  admin = { role: 'admin', userId: administrator.id }
})

afterAll(async () => {
  await queue.stop()
  await fake.close()
  await Promise.all(pools.map((pool) => pool.end()))
})

interface TestBuyer {
  context: Buyer
  email: string
  addressId: string
}

async function newBuyer(): Promise<TestBuyer> {
  const user = await createTestUser(owner)
  const address = await createTestAddress(owner, { userId: user.id })
  return {
    context: { role: 'buyer', userId: user.id },
    email: user.email,
    addressId: address.id,
  }
}

async function newItem(seller: Seller = pune, stock = 5) {
  const { product, variant } = await createTestProduct(owner, {
    sellerId: seller.sellerId,
    categoryId,
  })
  await owner
    .update(productVariants)
    .set({ pricePaise: 50_000, mrpPaise: 60_000, stock })
    .where(eq(productVariants.id, variant.id))
  return { product, variant }
}

/** A placed order with one line from each seller in `from`. */
async function placed(
  options: {
    buyer?: TestBuyer
    from?: Seller[]
    paymentMethod?: 'cod' | 'razorpay'
    coupon?: string
  } = {},
) {
  const buyer = options.buyer ?? (await newBuyer())
  const items = []
  for (const seller of options.from ?? [pune]) {
    const item = await newItem(seller)
    items.push(item)
    await withContext(web, buyer.context, (tx) =>
      addCartItem(tx, buyer.context, photos, {
        variantId: item.variant.id,
        quantity: 2,
      }),
    )
  }
  if (options.coupon) {
    await applyCoupon(
      web,
      buyer.context,
      photos,
      { code: options.coupon },
      randomUUID(),
    )
  }
  const result = await placeOrder(
    web,
    { queue, razorpay },
    buyer.context,
    { name: 'Asha Patil', email: buyer.email, phoneNumber: null },
    {
      addressId: buyer.addressId,
      paymentMethod: options.paymentMethod ?? 'cod',
    },
  )
  return { buyer, items, order: result.order, payment: result.payment }
}

/** Pays an online order through the webhook, as Razorpay would. */
async function pay(razorpayOrderId: string) {
  const paid = fake.pay(razorpayOrderId)
  return handleRazorpayWebhook(
    web,
    { queue, razorpay },
    fake.webhook('payment.captured', paid),
  )
}

const deps = () => ({ queue, photos })

const as = <T>(
  context: RequestContext,
  work: (tx: Transaction) => Promise<T>,
) => withContext(web, context, work)

const lineIdsOf = async (orderId: string, seller: Seller) =>
  (
    await owner
      .select({ id: orderItems.id })
      .from(orderItems)
      .where(
        and(
          eq(orderItems.orderId, orderId),
          eq(orderItems.sellerId, seller.sellerId),
        ),
      )
  ).map((row) => row.id)

const dispatch = async (
  orderId: string,
  seller: Seller = pune,
  extra: Record<string, unknown> = {},
) =>
  dispatchLines(web, deps(), seller, orderId, {
    lineIds: await lineIdsOf(orderId, seller),
    courierName: 'Delhivery',
    trackingNumber: 'DLV1234567',
    ...extra,
  })

const stockOf = async (variantId: string) =>
  (
    await owner
      .select({ stock: productVariants.stock })
      .from(productVariants)
      .where(eq(productVariants.id, variantId))
  )[0]!.stock

const emailsTo = (email: string) =>
  owner
    .select({ template: emailOutbox.template, payload: emailOutbox.payload })
    .from(emailOutbox)
    .where(eq(emailOutbox.toEmail, email))
    .orderBy(asc(emailOutbox.id))

const ledgerBalance = async (orderId: string) =>
  Number(
    (
      await owner
        .select({ total: sql<string>`coalesce(sum(amount_paise), 0)` })
        .from(sellerLedgerEntries)
        .where(eq(sellerLedgerEntries.orderId, orderId))
    )[0]!.total,
  )

describe('the buyer’s orders', () => {
  test('lists them newest first, a page at a time, with how far each has got', async () => {
    const buyer = await newBuyer()
    const first = await placed({ buyer })
    const second = await placed({ buyer, from: [pune, bengaluru] })
    await dispatch(second.order.id, pune)

    const page = await as(buyer.context, (tx) =>
      listBuyerOrders(tx, buyer.context, photos, { limit: 1 }),
    )
    expect(page.items).toEqual([
      expect.objectContaining({
        orderNumber: second.order.orderNumber,
        progress: 'partly_dispatched',
        itemCount: 4,
        totalPaise: 200_000,
        firstItem: { title: second.items[0]!.product.title, imageUrl: null },
      }),
    ])
    const next = await as(buyer.context, (tx) =>
      listBuyerOrders(tx, buyer.context, photos, {
        limit: 1,
        cursor: page.nextCursor!,
      }),
    )
    expect(next.items.map((item) => item.orderNumber)).toEqual([
      first.order.orderNumber,
    ])
    expect(next.nextCursor).toBeNull()
  })

  test('shows one order with its lines, parcels, payment, and invoices', async () => {
    const { buyer, order } = await placed({ from: [pune, bengaluru] })
    await dispatch(order.id, bengaluru)
    const view = await as(buyer.context, (tx) =>
      getBuyerOrder(tx, buyer.context, photos, order.id),
    )
    expect(view).toMatchObject({
      orderNumber: order.orderNumber,
      status: 'confirmed',
      progress: 'partly_dispatched',
      paymentState: 'pay_on_delivery',
      canCancel: false,
      totalPaise: 200_000,
    })
    expect(view.lines.map((line) => [line.lineNumber, line.status])).toEqual([
      [1, 'confirmed'],
      [2, 'dispatched'],
    ])
    expect(view.lines[1]!.shipment).toMatchObject({
      courierName: 'Delhivery',
      trackingNumber: 'DLV1234567',
      status: 'dispatched',
    })
    expect(view.lines[0]!.sellerName).toEqual(expect.any(String))
    expect(view.invoices).toHaveLength(2)
  })

  test('another buyer’s order is not found, and sellers cannot use the buyer view', async () => {
    const { order } = await placed()
    const stranger = await newBuyer()
    await expect(
      as(stranger.context, (tx) =>
        getBuyerOrder(tx, stranger.context, photos, order.id),
      ),
    ).rejects.toThrow(NotFoundError)
    await expect(
      as(pune, (tx) => listBuyerOrders(tx, pune, photos)),
    ).rejects.toThrow(ForbiddenError)
  })
})

describe('the seller’s queue', () => {
  test('shows confirmed orders to dispatch, oldest first, with only the seller’s own lines', async () => {
    const older = await placed({ from: [pune, bengaluru] })
    const newer = await placed({ from: [bengaluru, pune] })
    const unpaid = await placed({
      from: [bengaluru],
      paymentMethod: 'razorpay',
    })

    const queueOf = async (seller: Seller) => {
      const ids: string[] = []
      let cursor: string | undefined
      do {
        const page = await as(seller, (tx) =>
          listSellerOrders(tx, seller, photos, { cursor, limit: 100 }),
        )
        ids.push(...page.items.map((item) => item.id))
        cursor = page.nextCursor ?? undefined
      } while (cursor)
      return ids
    }
    const queued = await queueOf(bengaluru)
    expect(queued.indexOf(older.order.id)).toBeLessThan(
      queued.indexOf(newer.order.id),
    )
    expect(queued).not.toContain(unpaid.order.id)

    const view = await as(bengaluru, (tx) =>
      getSellerOrder(tx, bengaluru, photos, older.order.id),
    )
    expect(view.lines.map((line) => line.sellerId)).toEqual([
      bengaluru.sellerId,
    ])
    expect(view).toMatchObject({
      buyerName: 'Asha Patil',
      buyerPhone: '+919800000001',
      sellerTotalPaise: 100_000,
    })
    expect(view.invoices.map((invoice) => invoice.sellerId)).toEqual([
      bengaluru.sellerId,
    ])
    await expect(
      as(bengaluru, (tx) =>
        getSellerOrder(tx, bengaluru, photos, unpaid.order.id),
      ),
    ).rejects.toThrow(NotFoundError)
    // An order with none of the seller's lines is not theirs to see.
    const elsewhere = await placed({ from: [bengaluru] })
    await expect(
      as(pune, (tx) => getSellerOrder(tx, pune, photos, elsewhere.order.id)),
    ).rejects.toThrow(NotFoundError)
  })

  test('refuses a tab it does not know', async () => {
    await expect(
      as(pune, (tx) => listSellerOrders(tx, pune, photos, { tab: 'lost' })),
    ).rejects.toThrow(ValidationError)
  })
})

describe('dispatch', () => {
  test('sends the seller’s lines in one parcel and emails the buyer', async () => {
    const { buyer, order } = await placed({ from: [pune, bengaluru] })
    const view = await dispatch(order.id, pune, {
      trackingUrl: 'https://www.delhivery.com/track/DLV1234567',
    })
    expect(view.lines).toEqual([
      expect.objectContaining({
        status: 'dispatched',
        shipment: expect.objectContaining({
          trackingUrl: 'https://www.delhivery.com/track/DLV1234567',
        }),
      }),
    ])
    await dispatch(order.id, bengaluru)
    const emails = (await emailsTo(buyer.email)).filter(
      (email) => email.template === 'dispatched',
    )
    expect(emails.map((email) => email.payload)).toEqual([
      expect.objectContaining({
        wholeOrder: false,
        firstParcel: true,
        courierName: 'Delhivery',
      }),
      expect.objectContaining({ wholeOrder: true, firstParcel: false }),
    ])
    const events = await owner
      .select({ eventType: orderEvents.eventType })
      .from(orderEvents)
      .where(
        and(
          eq(orderEvents.orderId, order.id),
          eq(orderEvents.eventType, 'dispatched'),
        ),
      )
    expect(events).toHaveLength(2)
  })

  test('refuses lines already sent, other sellers’ lines, and bad details', async () => {
    const { order } = await placed({ from: [pune, bengaluru] })
    await dispatch(order.id, pune)
    await expect(dispatch(order.id, pune)).rejects.toThrow(
      /is already dispatched$/,
    )
    await expect(
      dispatchLines(web, deps(), pune, order.id, {
        lineIds: await lineIdsOf(order.id, bengaluru),
        courierName: 'Delhivery',
        trackingNumber: 'DLV1',
      }),
    ).rejects.toThrow(
      new ValidationError('Those dispatch details are not valid', [
        'lineIds must be your own lines of this order',
      ]),
    )
    await expect(
      dispatch(order.id, bengaluru, { trackingUrl: 'http://track.example' }),
    ).rejects.toThrow(ValidationError)
    const stranger = await createTestInvoicingSeller(owner)
    await expect(
      dispatchLines(
        web,
        deps(),
        {
          role: 'seller',
          userId: stranger.owner.id,
          sellerId: stranger.seller.id,
        },
        order.id,
        {
          lineIds: await lineIdsOf(order.id, bengaluru),
          courierName: 'Delhivery',
          trackingNumber: 'DLV1',
        },
      ),
    ).rejects.toThrow(NotFoundError)
  })

  test('refuses an order that is waiting for payment or cancelled', async () => {
    const unpaid = await placed({ paymentMethod: 'razorpay' })
    await expect(dispatch(unpaid.order.id)).rejects.toThrow(
      new ConflictError(
        `Order ${unpaid.order.orderNumber} is still waiting for payment, so nothing in it can be dispatched`,
      ),
    )
    const cancelled = await placed()
    await cancelOwnOrder(
      web,
      deps(),
      cancelled.buyer.context,
      cancelled.order.id,
      {},
    )
    await expect(dispatch(cancelled.order.id)).rejects.toThrow(ConflictError)
  })
})

describe('delivery', () => {
  test('completes the order with the last parcel and records the cash', async () => {
    const { buyer, order, items } = await placed({ from: [pune, bengaluru] })
    const first = await dispatch(order.id, pune)
    const second = await dispatch(order.id, bengaluru)
    const parcel = (view: typeof first) => view.lines[0]!.shipment!.id

    const verified = () =>
      as(buyer.context, (tx) =>
        findVerifiedPurchase(tx, buyer.context.userId, items[0]!.product.id),
      )
    expect(await verified()).toBeNull()
    const delivered = await markShipmentDelivered(web, pune, parcel(first))
    expect(delivered).toMatchObject({
      status: 'delivered',
      deliveredAt: expect.any(Date),
    })
    let [row] = await owner.select().from(orders).where(eq(orders.id, order.id))
    expect(row).toMatchObject({ status: 'confirmed', paidAt: null })

    await markShipmentDelivered(web, bengaluru, parcel(second))
    ;[row] = await owner.select().from(orders).where(eq(orders.id, order.id))
    expect(row).toMatchObject({
      status: 'completed',
      completedAt: expect.any(Date),
      paidAt: expect.any(Date),
    })
    const [payment] = await owner
      .select()
      .from(payments)
      .where(eq(payments.orderId, order.id))
    expect(payment?.status).toBe('captured')

    // Again changes nothing.
    await markShipmentDelivered(web, pune, parcel(first))
    const completions = await owner
      .select()
      .from(orderEvents)
      .where(
        and(
          eq(orderEvents.orderId, order.id),
          eq(orderEvents.eventType, 'completed'),
        ),
      )
    expect(completions).toHaveLength(1)

    expect(await verified()).toEqual({
      orderId: order.id,
      orderItemId: expect.any(String),
      deliveredAt: expect.any(Date),
    })
    const view = await as(buyer.context, (tx) =>
      getBuyerOrder(tx, buyer.context, photos, order.id),
    )
    expect(view).toMatchObject({
      status: 'completed',
      progress: 'delivered',
      paymentState: 'paid',
    })
  })

  test('only the parcel’s seller or an administrator can mark it delivered', async () => {
    const { order } = await placed()
    const view = await dispatch(order.id, pune)
    const parcel = view.lines[0]!.shipment!.id
    await expect(markShipmentDelivered(web, bengaluru, parcel)).rejects.toThrow(
      NotFoundError,
    )
    await markShipmentDelivered(web, admin, parcel, '203.0.113.9')
    const [entry] = await owner
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityId, parcel),
          eq(auditLogs.action, 'shipment.mark_delivered'),
        ),
      )
    expect(entry).toMatchObject({
      actorUserId: admin.userId,
      ip: '203.0.113.9',
    })
  })
})

describe('cancellation', () => {
  test('by the buyer puts everything back for a cash on delivery order', async () => {
    const coupon = await createTestCoupon(owner, admin.userId, {
      minOrderPaise: 0,
    })
    const { buyer, order, items } = await placed({
      from: [pune, bengaluru],
      coupon: coupon.code,
    })
    expect(await stockOf(items[0]!.variant.id)).toBe(3)
    expect(await ledgerBalance(order.id)).toBeGreaterThan(0)

    const view = await cancelOwnOrder(web, deps(), buyer.context, order.id, {
      reason: 'Ordered the wrong size',
    })
    expect(view).toMatchObject({
      status: 'cancelled',
      progress: 'cancelled',
      paymentState: 'not_charged',
      canCancel: false,
      cancelReason: 'Ordered the wrong size',
    })
    expect(view.lines.map((line) => line.status)).toEqual([
      'cancelled',
      'cancelled',
    ])
    expect(await stockOf(items[0]!.variant.id)).toBe(5)
    expect(await stockOf(items[1]!.variant.id)).toBe(5)
    const [used] = await owner
      .select({ usedCount: coupons.usedCount })
      .from(coupons)
      .where(eq(coupons.id, coupon.id))
    expect(used?.usedCount).toBe(0)
    expect(await ledgerBalance(order.id)).toBe(0)
    const cancelledInvoices = await owner
      .select({ reason: invoices.cancelReason })
      .from(invoices)
      .where(eq(invoices.orderId, order.id))
    expect(cancelledInvoices).toEqual([
      { reason: 'Cancelled by the buyer before dispatch' },
      { reason: 'Cancelled by the buyer before dispatch' },
    ])
    const [payment] = await owner
      .select()
      .from(payments)
      .where(eq(payments.orderId, order.id))
    expect(payment).toMatchObject({
      status: 'failed',
      failureReason: 'The order was cancelled',
    })
    const emails = await emailsTo(buyer.email)
    expect(emails.at(-1)).toEqual({
      template: 'cancelled',
      payload: expect.objectContaining({
        cancelledBy: 'buyer',
        money: { kind: 'nothing_charged' },
      }),
    })

    await expect(
      cancelOwnOrder(web, deps(), buyer.context, order.id, {}),
    ).rejects.toThrow(
      new ConflictError(`Order ${order.orderNumber} is already cancelled`),
    )
    expect(await ledgerBalance(order.id)).toBe(0)
  })

  test('of a paid online order flags the refund for administrators', async () => {
    const { buyer, order, payment } = await placed({
      paymentMethod: 'razorpay',
    })
    expect(await pay(payment!.razorpayOrderId)).toBe('confirmed')
    const view = await cancelOwnOrder(web, deps(), buyer.context, order.id, {})
    expect(view).toMatchObject({
      paymentState: 'refund_due',
      cancelReason: 'Cancelled by the buyer',
    })
    const page = await as(admin, (tx) =>
      listAdminOrders(tx, admin, { needsRefund: true, limit: 100 }),
    )
    expect(page.items).toContainEqual(
      expect.objectContaining({
        id: order.id,
        needsRefund: true,
        paymentStatus: 'captured',
      }),
    )
    const emails = await emailsTo(buyer.email)
    expect(emails.at(-1)?.payload).toMatchObject({
      money: { kind: 'refund', amountPaise: 100_000 },
    })
  })

  test('of an unpaid online order closes the payment, and a late payment is flagged', async () => {
    const { buyer, order, payment } = await placed({
      paymentMethod: 'razorpay',
    })
    await cancelOwnOrder(web, deps(), buyer.context, order.id, {})
    const [row] = await owner
      .select()
      .from(payments)
      .where(eq(payments.orderId, order.id))
    expect(row?.status).toBe('failed')
    expect(await pay(payment!.razorpayOrderId)).toBe('needs_refund')
    const view = await as(admin, (tx) =>
      getAdminOrder(tx, admin, photos, order.id),
    )
    expect(view).toMatchObject({
      needsRefund: true,
      paymentState: 'refund_due',
    })
  })

  test('is refused once anything is dispatched, and for another buyer’s order', async () => {
    const { buyer, order } = await placed({ from: [pune, bengaluru] })
    const stranger = await newBuyer()
    await expect(
      cancelOwnOrder(web, deps(), stranger.context, order.id, {}),
    ).rejects.toThrow(NotFoundError)
    await dispatch(order.id, pune)
    await expect(
      cancelOwnOrder(web, deps(), buyer.context, order.id, {}),
    ).rejects.toThrow(
      new ConflictError(
        `Part of order ${order.orderNumber} has been dispatched, so it cannot be cancelled now`,
      ),
    )
  })

  test('by an administrator needs a reason and is audited', async () => {
    const { order, buyer } = await placed()
    await expect(
      cancelOrderAsAdmin(web, deps(), admin, order.id, {}),
    ).rejects.toThrow(ValidationError)
    await expect(
      cancelOrderAsAdmin(web, deps(), pune, order.id, { reason: 'x' }),
    ).rejects.toThrow(ForbiddenError)
    const view = await cancelOrderAsAdmin(
      web,
      deps(),
      admin,
      order.id,
      { reason: 'The seller cannot supply it' },
      '203.0.113.7',
    )
    expect(view).toMatchObject({
      status: 'cancelled',
      cancelReason: 'The seller cannot supply it',
    })
    expect(view.events.map((event) => event.eventType)).toEqual([
      'placed',
      'cancelled',
    ])
    const [entry] = await owner
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityId, order.id),
          eq(auditLogs.action, 'order.cancel'),
        ),
      )
    expect(entry).toMatchObject({ actorUserId: admin.userId })
    expect((await emailsTo(buyer.email)).at(-1)?.payload).toMatchObject({
      cancelledBy: 'ecokart',
      reason: 'The seller cannot supply it',
    })
  })

  test('and dispatch racing for the same order: exactly one wins', async () => {
    const { buyer, order } = await placed()
    const lineIds = await lineIdsOf(order.id, pune)
    const hold = await holdRows(owner, orders, orders.id, [order.id])
    const attempts = [
      cancelOwnOrder(web, deps(), buyer.context, order.id, {}),
      dispatchLines(web, deps(), pune, order.id, {
        lineIds,
        courierName: 'Delhivery',
        trackingNumber: 'DLV42',
      }),
    ] as Promise<unknown>[]
    for (const attempt of attempts) attempt.catch(() => {})
    await waitUntil(
      async () => (await sessionsWaitingOn(owner, hold.pid)) === 2,
    )
    hold.release()
    await hold.finished
    const results = await Promise.allSettled(attempts)
    expect(results.map((result) => result.status).toSorted()).toEqual([
      'fulfilled',
      'rejected',
    ])
    const lines = await owner
      .select({ status: orderItems.status })
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id))
    const [row] = await owner
      .select()
      .from(orders)
      .where(eq(orders.id, order.id))
    expect(
      (row?.status === 'cancelled' && lines[0]?.status === 'cancelled') ||
        (row?.status === 'confirmed' && lines[0]?.status === 'dispatched'),
    ).toBe(true)
  })
})

describe('the administrators’ list', () => {
  test('filters by status and finds one order by its number', async () => {
    const { order } = await placed()
    const byNumber = await as(admin, (tx) =>
      listAdminOrders(tx, admin, {
        orderNumber: order.orderNumber.toLowerCase(),
      }),
    )
    expect(byNumber.items).toEqual([
      expect.objectContaining({
        id: order.id,
        status: 'confirmed',
        paymentStatus: 'created',
        needsRefund: false,
      }),
    ])
    const pending = await as(admin, (tx) =>
      listAdminOrders(tx, admin, { status: 'pending_payment', limit: 100 }),
    )
    expect(
      pending.items.every((item) => item.status === 'pending_payment'),
    ).toBe(true)
    await expect(
      as(admin, (tx) => listAdminOrders(tx, admin, { status: 'lost' })),
    ).rejects.toThrow(ValidationError)
    await expect(
      as(pune, (tx) => listAdminOrders(tx, pune, {})),
    ).rejects.toThrow(ForbiddenError)
  })
})
