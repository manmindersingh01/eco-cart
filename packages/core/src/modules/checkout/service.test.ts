import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import {
  cartItems,
  carts,
  coupons,
  emailOutbox,
  invoices,
  orderEvents,
  orderItems,
  orders,
  paymentEvents,
  payments,
  platformSettings,
  products,
  productVariants,
  sellerLedgerEntries,
  sellers,
} from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  TooManyRequestsError,
  UnavailableError,
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
  TEST_SETTINGS,
} from '../../testing/fixtures.ts'
import { holdRows, sessionsWaitingOn, waitUntil } from '../../testing/locks.ts'
import { startFakeRazorpay, type FakeRazorpay } from '../../testing/razorpay.ts'
import { addCartItem, applyCoupon } from '../cart/service.ts'
import { expireUnpaidOrders } from '../orders/jobs.ts'
import {
  confirmCheckoutPayment,
  handleRazorpayWebhook,
} from '../payments/service.ts'
import { CHECKOUTS_PER_HOUR, placeOrder, type BuyerAccount } from './service.ts'

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'checkout-test')
  pools.push(pool)
  return createDatabase(pool)
}
const web = connect(requireEnv('DATABASE_URL'))
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))
const photos = { publicUrl: (key: string) => `https://cdn.test/${key}` }

let queue: JobQueue
let fake: FakeRazorpay
let razorpay: Razorpay
let categoryId: string
let pune: { id: string; stateCode: string }
let bengaluru: { id: string; stateCode: string }
let adminId: string

beforeAll(async () => {
  await saveTestSettings(owner)
  queue = await startJobQueue(requireEnv('DATABASE_URL'), 'checkout-test')
  fake = await startFakeRazorpay()
  razorpay = createRazorpay(fake.config)
  const [first, second, category, admin] = await Promise.all([
    createTestInvoicingSeller(owner, { stateCode: '27' }),
    createTestInvoicingSeller(owner, { stateCode: '29' }),
    createTestCategory(owner),
    createTestUser(owner, 'admin'),
  ])
  pune = first.seller
  bengaluru = second.seller
  categoryId = category.id
  adminId = admin.id
})

afterAll(async () => {
  await queue.stop()
  await fake.close()
  await Promise.all(pools.map((pool) => pool.end()))
})

type Buyer = Extract<RequestContext, { role: 'buyer' }>

interface TestBuyer {
  context: Buyer
  account: BuyerAccount
  addressId: string
}

async function newBuyer(): Promise<TestBuyer> {
  const user = await createTestUser(owner)
  const address = await createTestAddress(owner, { userId: user.id })
  return {
    context: { role: 'buyer', userId: user.id },
    account: { name: 'Asha Patil', email: user.email, phoneNumber: null },
    addressId: address.id,
  }
}

/** An approved item from `seller`. */
async function newItem(
  options: { seller?: string; pricePaise?: number; stock?: number } = {},
) {
  const { product, variant } = await createTestProduct(owner, {
    sellerId: options.seller ?? pune.id,
    categoryId,
  })
  const pricePaise = options.pricePaise ?? 50_000
  await owner
    .update(productVariants)
    .set({
      pricePaise,
      mrpPaise: Math.max(pricePaise, 60_000),
      stock: options.stock ?? 5,
    })
    .where(eq(productVariants.id, variant.id))
  return { product, variant }
}

const addToCart = (buyer: TestBuyer, variantId: string, quantity = 1) =>
  withContext(web, buyer.context, (tx) =>
    addCartItem(tx, buyer.context, photos, { variantId, quantity }),
  )

const checkout = (
  buyer: TestBuyer,
  paymentMethod: 'razorpay' | 'cod',
  extra: Record<string, unknown> = {},
  online: Razorpay | null = razorpay,
) =>
  placeOrder(web, { queue, razorpay: online }, buyer.context, buyer.account, {
    addressId: buyer.addressId,
    paymentMethod,
    ...extra,
  })

const stockOf = async (variantId: string) =>
  (
    await owner
      .select({ stock: productVariants.stock })
      .from(productVariants)
      .where(eq(productVariants.id, variantId))
  )[0]!.stock

const orderRow = async (orderId: string) =>
  (await owner.select().from(orders).where(eq(orders.id, orderId)))[0]!

const linesOf = (orderId: string) =>
  owner
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.lineNumber))

const ledgerOf = (orderId: string) =>
  owner
    .select({
      sellerId: sellerLedgerEntries.sellerId,
      entryType: sellerLedgerEntries.entryType,
      amountPaise: sellerLedgerEntries.amountPaise,
    })
    .from(sellerLedgerEntries)
    .where(eq(sellerLedgerEntries.orderId, orderId))
    .orderBy(asc(sellerLedgerEntries.id))

const invoicesOf = (orderId: string) =>
  owner
    .select({
      sellerId: invoices.sellerId,
      isInterstate: invoices.isInterstate,
    })
    .from(invoices)
    .where(eq(invoices.orderId, orderId))

const emailsTo = (email: string) =>
  owner
    .select({ template: emailOutbox.template, subject: emailOutbox.subject })
    .from(emailOutbox)
    .where(eq(emailOutbox.toEmail, email))
    .orderBy(asc(emailOutbox.id))

const paymentOf = async (orderId: string) =>
  (await owner.select().from(payments).where(eq(payments.orderId, orderId)))[0]!

describe('cash on delivery', () => {
  test('confirms the order at once, with every value frozen', async () => {
    const buyer = await newBuyer()
    const first = await newItem({ pricePaise: 50_000, stock: 5 })
    const second = await newItem({
      seller: bengaluru.id,
      pricePaise: 29_900,
      stock: 3,
    })
    await addToCart(buyer, first.variant.id, 2)
    await addToCart(buyer, second.variant.id, 1)

    const placed = await checkout(buyer, 'cod', { expectedTotalPaise: 129_900 })
    expect(placed).toEqual({
      order: {
        id: expect.any(String),
        orderNumber: expect.stringMatching(/^EK-\d{6}-\d{6,}$/),
        status: 'confirmed',
        paymentMethod: 'cod',
        totalPaise: 129_900,
      },
      payment: null,
    })

    const order = await orderRow(placed.order.id)
    expect(order).toMatchObject({
      status: 'confirmed',
      paymentMethod: 'cod',
      subtotalPaise: 129_900,
      discountPaise: 0,
      deliveryPaise: 0,
      totalPaise: 129_900,
      buyerName: 'Asha Patil',
      buyerPhone: '+919800000001',
      buyerEmail: buyer.account.email,
      shippingAddress: expect.objectContaining({
        city: 'Pune',
        stateCode: '27',
      }),
      paidAt: null,
    })
    const lines = await linesOf(order.id)
    expect(lines).toMatchObject([
      {
        lineNumber: 1,
        variantId: first.variant.id,
        title: first.product.title,
        sku: first.variant.sku,
        hsnCode: '3924',
        gstRateBps: 1800,
        unitPricePaise: 50_000,
        unitMrpPaise: 60_000,
        quantity: 2,
        lineTotalPaise: 100_000,
        discountSharePaise: 0,
        taxablePaise: 84_746,
        taxPaise: 15_254,
        commissionBps: 1_000,
        commissionPaise: 10_000,
        status: 'confirmed',
      },
      { lineNumber: 2, variantId: second.variant.id, quantity: 1 },
    ])
    expect(await stockOf(first.variant.id)).toBe(3)
    expect(await stockOf(second.variant.id)).toBe(2)
    expect(await paymentOf(order.id)).toMatchObject({
      provider: 'cod',
      status: 'created',
      method: 'cod',
      amountPaise: 129_900,
    })
    expect(await ledgerOf(order.id)).toEqual([
      { sellerId: pune.id, entryType: 'sale', amountPaise: 100_000 },
      { sellerId: pune.id, entryType: 'commission', amountPaise: -10_000 },
      { sellerId: bengaluru.id, entryType: 'sale', amountPaise: 29_900 },
      { sellerId: bengaluru.id, entryType: 'commission', amountPaise: -2_990 },
    ])
    expect(
      (await invoicesOf(order.id)).toSorted((a, b) =>
        a.sellerId.localeCompare(b.sellerId),
      ),
    ).toEqual(
      [
        { sellerId: pune.id, isInterstate: false },
        { sellerId: bengaluru.id, isInterstate: true },
      ].toSorted((a, b) => a.sellerId.localeCompare(b.sellerId)),
    )
    expect(await emailsTo(buyer.account.email!)).toEqual([
      {
        template: 'order_placed',
        subject: `Your EcoKart order ${order.orderNumber} is placed`,
      },
    ])
    const cart = await owner
      .select({ id: cartItems.id })
      .from(cartItems)
      .innerJoin(carts, eq(carts.id, cartItems.cartId))
      .where(eq(carts.userId, buyer.context.userId))
    expect(cart).toEqual([])

    // A later catalogue edit never changes the order.
    await owner
      .update(products)
      .set({ title: 'Renamed' })
      .where(eq(products.id, first.product.id))
    await owner
      .update(productVariants)
      .set({ pricePaise: 10_000 })
      .where(eq(productVariants.id, first.variant.id))
    expect((await linesOf(order.id))[0]).toMatchObject({
      title: first.product.title,
      unitPricePaise: 50_000,
    })
  })

  test('splits a coupon over the lines and freezes tax and commission after it', async () => {
    const buyer = await newBuyer()
    const coupon = await createTestCoupon(owner, adminId, {
      discountValue: 1_000,
      maxDiscountPaise: null,
      minOrderPaise: 0,
    })
    await owner
      .update(sellers)
      .set({ commissionBps: 500 })
      .where(eq(sellers.id, bengaluru.id))
    try {
      const first = await newItem({ pricePaise: 33_333 })
      const second = await newItem({ seller: bengaluru.id, pricePaise: 16_667 })
      await addToCart(buyer, first.variant.id)
      await addToCart(buyer, second.variant.id)
      await applyCoupon(
        web,
        buyer.context,
        photos,
        { code: coupon.code },
        randomUUID(),
      )
      const placed = await checkout(buyer, 'cod')
      const order = await orderRow(placed.order.id)
      expect(order).toMatchObject({
        subtotalPaise: 50_000,
        discountPaise: 5_000,
        deliveryPaise: 4_900,
        totalPaise: 49_900,
        couponId: coupon.id,
        couponCode: coupon.code,
      })
      const lines = await linesOf(order.id)
      expect(lines.map((line) => line.discountSharePaise)).toEqual([
        3_333, 1_667,
      ])
      for (const line of lines) {
        expect(line.taxablePaise + line.taxPaise).toBe(
          line.lineTotalPaise - line.discountSharePaise,
        )
      }
      expect(
        lines.map((line) => [line.commissionBps, line.commissionPaise]),
      ).toEqual([
        [1_000, 3_000],
        [500, 750],
      ])
      const [used] = await owner
        .select({ usedCount: coupons.usedCount })
        .from(coupons)
        .where(eq(coupons.id, coupon.id))
      expect(used?.usedCount).toBe(1)
    } finally {
      await owner
        .update(sellers)
        .set({ commissionBps: null })
        .where(eq(sellers.id, bengaluru.id))
    }
  })

  test('is refused when switched off in the settings', async () => {
    const buyer = await newBuyer()
    const { variant } = await newItem()
    await addToCart(buyer, variant.id)
    // The setting is switched off only inside a transaction that is always
    // rolled back, and the order is placed in that same transaction. Saved
    // for real, other test files placing cash on delivery orders at the same
    // time were refused now and then.
    const rolledBack = new Error('rolled back on purpose')
    await expect(
      web.transaction(async (tx) => {
        await tx
          .insert(platformSettings)
          .values({ key: 'cod_enabled', value: false })
          .onConflictDoUpdate({
            target: platformSettings.key,
            set: { value: false },
          })
        await expect(
          placeOrder(
            // placeOrder only opens transactions on it, which a transaction
            // does as savepoints, and passes it to consumeRateLimit, which
            // takes a transaction too.
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion
            tx as unknown as typeof web,
            { queue, razorpay },
            buyer.context,
            buyer.account,
            { addressId: buyer.addressId, paymentMethod: 'cod' },
          ),
        ).rejects.toThrow(
          new ConflictError(
            'Cash on delivery is not available right now; please pay online',
          ),
        )
        throw rolledBack
      }),
    ).rejects.toBe(rolledBack)
    expect(await stockOf(variant.id)).toBe(5)
  })
})

describe('paying online', () => {
  test('waits for payment, then the browser return confirms the order', async () => {
    const buyer = await newBuyer()
    const { variant } = await newItem()
    await addToCart(buyer, variant.id, 2)
    const placed = await checkout(buyer, 'razorpay')
    expect(placed.order.status).toBe('pending_payment')
    expect(placed.payment).toEqual({
      provider: 'razorpay',
      keyId: fake.config.keyId,
      razorpayOrderId: expect.stringMatching(/^order_/),
      amountPaise: 100_000,
      currency: 'INR',
      prefill: {
        name: 'Asha Patil',
        email: buyer.account.email,
        contact: '+919800000001',
      },
    })
    const razorpayOrder = fake.orders.get(placed.payment!.razorpayOrderId)
    expect(razorpayOrder).toMatchObject({
      amount: 100_000,
      receipt: placed.order.orderNumber,
    })
    expect(await stockOf(variant.id)).toBe(3)
    expect(await ledgerOf(placed.order.id)).toEqual([])
    expect(await invoicesOf(placed.order.id)).toEqual([])
    expect(await paymentOf(placed.order.id)).toMatchObject({
      status: 'created',
      providerOrderId: placed.payment!.razorpayOrderId,
    })

    const paid = fake.pay(placed.payment!.razorpayOrderId, { method: 'card' })
    const result = await confirmCheckoutPayment(
      web,
      { queue, razorpay },
      buyer.context,
      fake.checkoutReturn(paid),
    )
    expect(result).toEqual({
      orderId: placed.order.id,
      orderNumber: placed.order.orderNumber,
      status: 'confirmed',
    })
    expect(await orderRow(placed.order.id)).toMatchObject({
      status: 'confirmed',
      paidAt: expect.any(Date),
    })
    expect(await paymentOf(placed.order.id)).toMatchObject({
      status: 'captured',
      providerPaymentId: paid.id,
      method: 'card',
    })
    expect(await ledgerOf(placed.order.id)).toHaveLength(2)
    expect(await invoicesOf(placed.order.id)).toHaveLength(1)
    expect(
      (await emailsTo(buyer.account.email!)).map((email) => email.template),
    ).toEqual(['order_placed', 'payment_received'])
  })

  test('refuses a forged return, and another buyer’s payment', async () => {
    const buyer = await newBuyer()
    const { variant } = await newItem()
    await addToCart(buyer, variant.id)
    const placed = await checkout(buyer, 'razorpay')
    const paid = fake.pay(placed.payment!.razorpayOrderId)
    const genuine = fake.checkoutReturn(paid)
    await expect(
      confirmCheckoutPayment(web, { queue, razorpay }, buyer.context, {
        ...genuine,
        razorpaySignature: 'f'.repeat(64),
      }),
    ).rejects.toThrow(new ValidationError('The payment signature is not valid'))
    const stranger = await newBuyer()
    await expect(
      confirmCheckoutPayment(
        web,
        { queue, razorpay },
        stranger.context,
        genuine,
      ),
    ).rejects.toThrow(NotFoundError)
    expect((await orderRow(placed.order.id)).status).toBe('pending_payment')
  })

  test('puts everything back when Razorpay cannot start the payment', async () => {
    const buyer = await newBuyer()
    const { variant } = await newItem()
    const coupon = await createTestCoupon(owner, adminId, { minOrderPaise: 0 })
    await addToCart(buyer, variant.id, 2)
    await applyCoupon(
      web,
      buyer.context,
      photos,
      { code: coupon.code },
      randomUUID(),
    )
    fake.failNextOrder(502)
    await expect(checkout(buyer, 'razorpay')).rejects.toThrow(UnavailableError)

    const [order] = await owner
      .select()
      .from(orders)
      .where(eq(orders.userId, buyer.context.userId))
    expect(order).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Online payment could not be started',
    })
    expect(await paymentOf(order!.id)).toMatchObject({ status: 'failed' })
    expect(await stockOf(variant.id)).toBe(5)
    const [{ usedCount } = { usedCount: -1 }] = await owner
      .select({ usedCount: coupons.usedCount })
      .from(coupons)
      .where(eq(coupons.id, coupon.id))
    expect(usedCount).toBe(0)
    const [cart] = await owner
      .select()
      .from(carts)
      .where(eq(carts.userId, buyer.context.userId))
    expect(cart?.couponCode).toBe(coupon.code)
    const items = await owner
      .select({ quantity: cartItems.quantity })
      .from(cartItems)
      .where(eq(cartItems.cartId, cart!.id))
    expect(items).toEqual([{ quantity: 2 }])
  })

  test('is refused while online payment is switched off', async () => {
    const buyer = await newBuyer()
    const { variant } = await newItem()
    await addToCart(buyer, variant.id)
    await expect(checkout(buyer, 'razorpay', {}, null)).rejects.toThrow(
      new ConflictError(
        'Online payment is not available yet; please choose cash on delivery',
      ),
    )
  })

  test('allows at most 3 orders waiting for payment', async () => {
    const buyer = await newBuyer()
    const { variant } = await newItem({ stock: 10 })
    for (let n = 0; n < 3; n += 1) {
      await addToCart(buyer, variant.id)
      await checkout(buyer, 'razorpay')
    }
    await addToCart(buyer, variant.id)
    await expect(checkout(buyer, 'razorpay')).rejects.toThrow(
      new ConflictError(
        'You have 3 orders waiting for payment; please pay for one, or wait until it expires',
      ),
    )
  })
})

/** An online order waiting for payment, and the payment the buyer made. */
async function pendingOrder() {
  const buyer = await newBuyer()
  const { variant } = await newItem()
  await addToCart(buyer, variant.id)
  const placed = await checkout(buyer, 'razorpay')
  return { buyer, placed, paid: fake.pay(placed.payment!.razorpayOrderId) }
}

const deliver = (delivery: {
  rawBody: string
  signature: string | null
  eventId: string | null
}) => handleRazorpayWebhook(web, { queue, razorpay }, delivery)

describe('the Razorpay webhook', () => {
  test('confirms once, however often and however the payment is reported', async () => {
    const { buyer, placed, paid } = await pendingOrder()
    const captured = fake.webhook('payment.captured', paid)
    expect(await deliver(captured)).toBe('confirmed')
    expect(await deliver(captured)).toBe('replay')
    expect(await deliver(fake.webhook('order.paid', paid))).toBe(
      'already_confirmed',
    )
    await confirmCheckoutPayment(
      web,
      { queue, razorpay },
      buyer.context,
      fake.checkoutReturn(paid),
    )

    expect(await ledgerOf(placed.order.id)).toHaveLength(2)
    expect(await invoicesOf(placed.order.id)).toHaveLength(1)
    const events = await owner
      .select()
      .from(paymentEvents)
      .where(eq(paymentEvents.eventId, captured.eventId))
    expect(events).toEqual([
      expect.objectContaining({
        eventType: 'payment.captured',
        signatureValid: true,
        processedAt: expect.any(Date),
        error: null,
      }),
    ])
    const paidEvents = await owner
      .select()
      .from(orderEvents)
      .where(
        and(
          eq(orderEvents.orderId, placed.order.id),
          eq(orderEvents.eventType, 'paid'),
        ),
      )
    expect(paidEvents).toHaveLength(1)
  })

  test('refuses a delivery whose signature does not match, before reading it', async () => {
    const { placed, paid } = await pendingOrder()
    const captured = fake.webhook('payment.captured', paid)
    for (const signature of ['0'.repeat(64), null]) {
      await expect(deliver({ ...captured, signature })).rejects.toThrow(
        new ValidationError('The webhook signature is not valid'),
      )
    }
    await expect(
      deliver({
        ...captured,
        rawBody: captured.rawBody.replace('upi', 'card'),
      }),
    ).rejects.toThrow(ValidationError)
    expect((await orderRow(placed.order.id)).status).toBe('pending_payment')
    const stored = await owner
      .select()
      .from(paymentEvents)
      .where(eq(paymentEvents.eventId, captured.eventId))
    expect(stored).toEqual([])
  })

  test('records a failed attempt and leaves the order waiting', async () => {
    const buyer = await newBuyer()
    const { variant } = await newItem()
    await addToCart(buyer, variant.id)
    const placed = await checkout(buyer, 'razorpay')
    const declined = fake.pay(placed.payment!.razorpayOrderId, {
      status: 'failed',
    })
    expect(await deliver(fake.webhook('payment.failed', declined))).toBe(
      'failure_recorded',
    )
    expect(await paymentOf(placed.order.id)).toMatchObject({
      status: 'created',
      failureReason: 'Your bank declined the payment',
    })
    expect((await orderRow(placed.order.id)).status).toBe('pending_payment')
  })

  test('is not there while online payment is switched off', async () => {
    const { paid } = await pendingOrder()
    await expect(
      handleRazorpayWebhook(
        web,
        { queue, razorpay: null },
        fake.webhook('payment.captured', paid),
      ),
    ).rejects.toThrow(NotFoundError)
  })

  test('ignores a payment for an order that is not ours', async () => {
    const stranger = {
      id: 'pay_unknown',
      order_id: 'order_unknown',
      amount: 10_000,
      currency: 'INR' as const,
      status: 'captured' as const,
      method: 'upi',
      error_description: null,
    }
    expect(await deliver(fake.webhook('payment.captured', stranger))).toBe(
      'unknown_order',
    )
  })
})

describe('unpaid orders', () => {
  test('expire after the payment timeout, giving stock and coupon back', async () => {
    const buyer = await newBuyer()
    const { variant } = await newItem()
    const coupon = await createTestCoupon(owner, adminId, { minOrderPaise: 0 })
    await addToCart(buyer, variant.id, 2)
    await applyCoupon(
      web,
      buyer.context,
      photos,
      { code: coupon.code },
      randomUUID(),
    )
    const placed = await checkout(buyer, 'razorpay')
    expect(await stockOf(variant.id)).toBe(3)

    const early = await expireUnpaidOrders(
      web,
      new Date(Date.now() + 29 * 60_000),
    )
    expect(early).not.toContain(placed.order.orderNumber)
    const late = await expireUnpaidOrders(
      web,
      new Date(Date.now() + 31 * 60_000),
    )
    expect(late).toContain(placed.order.orderNumber)

    expect(await orderRow(placed.order.id)).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Not paid within 30 minutes',
    })
    expect(await stockOf(variant.id)).toBe(5)
    const [used] = await owner
      .select({ usedCount: coupons.usedCount })
      .from(coupons)
      .where(eq(coupons.id, coupon.id))
    expect(used?.usedCount).toBe(0)
    expect(await paymentOf(placed.order.id)).toMatchObject({
      status: 'failed',
      failureReason: 'Not paid within 30 minutes',
    })

    // The money arrives after all: kept, and flagged for a refund.
    const paid = fake.pay(placed.payment!.razorpayOrderId)
    expect(
      await handleRazorpayWebhook(
        web,
        { queue, razorpay },
        fake.webhook('payment.captured', paid),
      ),
    ).toBe('needs_refund')
    expect((await orderRow(placed.order.id)).status).toBe('cancelled')
    expect(await paymentOf(placed.order.id)).toMatchObject({
      status: 'captured',
    })
    const flags = await owner
      .select({ eventType: orderEvents.eventType })
      .from(orderEvents)
      .where(
        and(
          eq(orderEvents.orderId, placed.order.id),
          eq(orderEvents.eventType, 'payment_needs_refund'),
        ),
      )
    expect(flags).toHaveLength(1)
    expect(await ledgerOf(placed.order.id)).toEqual([])
  })
})

describe('what checkout refuses', () => {
  test('an empty cart, a changed total, too much, and someone else’s address', async () => {
    const buyer = await newBuyer()
    await expect(checkout(buyer, 'cod')).rejects.toThrow(
      new ConflictError('Your cart is empty'),
    )
    const { product, variant } = await newItem({ stock: 5 })
    await addToCart(buyer, variant.id, 2)
    await expect(
      checkout(buyer, 'cod', { expectedTotalPaise: 90_000 }),
    ).rejects.toThrow(
      new ConflictError(
        'Your total is now ₹1,000, not ₹900; please review your cart',
      ),
    )
    await owner
      .update(productVariants)
      .set({ stock: 1 })
      .where(eq(productVariants.id, variant.id))
    await expect(checkout(buyer, 'cod')).rejects.toThrow(
      new ConflictError(
        `Only 1 of ${product.title} is left. Please review your cart.`,
      ),
    )
    await owner
      .update(productVariants)
      .set({ stock: 5 })
      .where(eq(productVariants.id, variant.id))
    const stranger = await newBuyer()
    await expect(
      checkout({ ...buyer, addressId: stranger.addressId }, 'cod'),
    ).rejects.toThrow(NotFoundError)
    expect(await stockOf(variant.id)).toBe(5)
  })

  test('anyone but a buyer', async () => {
    for (const context of [
      { role: 'seller', userId: randomUUID(), sellerId: randomUUID() },
      { role: 'admin', userId: randomUUID() },
      { role: 'anonymous' },
    ] as RequestContext[]) {
      await expect(
        placeOrder(
          web,
          { queue, razorpay },
          context,
          {
            name: '',
            email: null,
            phoneNumber: null,
          },
          {},
        ),
      ).rejects.toThrow(ForbiddenError)
    }
  })

  test(`more than ${CHECKOUTS_PER_HOUR} attempts an hour`, async () => {
    const buyer = await newBuyer()
    for (let n = 0; n < CHECKOUTS_PER_HOUR; n += 1) {
      await expect(checkout(buyer, 'cod')).rejects.toThrow(ConflictError)
    }
    await expect(checkout(buyer, 'cod')).rejects.toThrow(TooManyRequestsError)
  })
})

describe('buyers racing each other', () => {
  test('only one of two buyers gets the last unit', async () => {
    const { product, variant } = await newItem({ stock: 1 })
    const asha = await newBuyer()
    const ravi = await newBuyer()
    await addToCart(asha, variant.id)
    await addToCart(ravi, variant.id)

    const hold = await holdRows(owner, products, products.id, [product.id])
    const attempts = [asha, ravi].map((buyer) => checkout(buyer, 'cod'))
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
    const refused = results.find((result) => result.status === 'rejected')
    expect(refused?.reason).toBeInstanceOf(ConflictError)
    expect(await stockOf(variant.id)).toBe(0)
    const sold = await owner
      .select({ quantity: orderItems.quantity })
      .from(orderItems)
      .where(eq(orderItems.variantId, variant.id))
    expect(sold).toEqual([{ quantity: 1 }])
  })

  test('only one of two buyers gets the last use of a coupon', async () => {
    const coupon = await createTestCoupon(owner, adminId, {
      usageLimit: 1,
      minOrderPaise: 0,
    })
    const buyers = [await newBuyer(), await newBuyer()]
    for (const buyer of buyers) {
      const { variant } = await newItem()
      await addToCart(buyer, variant.id)
      await applyCoupon(
        web,
        buyer.context,
        photos,
        { code: coupon.code },
        randomUUID(),
      )
    }

    const hold = await holdRows(owner, coupons, coupons.id, [coupon.id])
    const attempts = buyers.map((buyer) => checkout(buyer, 'cod'))
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
    const refused = results.find((result) => result.status === 'rejected')
    expect(refused?.reason).toEqual(
      new ConflictError(
        'This coupon has been used up. Remove the coupon to place your order.',
      ),
    )
    const placed = await owner
      .select({ id: orders.id })
      .from(orders)
      .where(
        inArray(
          orders.userId,
          buyers.map((buyer) => buyer.context.userId),
        ),
      )
    expect(placed).toHaveLength(1)
    const [used] = await owner
      .select({ usedCount: coupons.usedCount })
      .from(coupons)
      .where(eq(coupons.id, coupon.id))
    expect(used?.usedCount).toBe(1)
  })
})

describe('the settings checkout needs', () => {
  test('are the ones saved for these tests', () => {
    expect(TEST_SETTINGS.delivery_charge_paise).toBe(4_900)
  })
})
