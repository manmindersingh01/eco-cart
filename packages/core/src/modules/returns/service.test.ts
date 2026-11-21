import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDatabase, type Transaction } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import {
  auditLogs,
  emailOutbox,
  orderItems,
  payments,
  platformSettings,
  productVariants,
  returnPhotos,
  shipments,
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
  createTestInvoicingSeller,
  createTestProduct,
  createTestUser,
  saveTestSettings,
} from '../../testing/fixtures.ts'
import { startFakeRazorpay, type FakeRazorpay } from '../../testing/razorpay.ts'
import { addCartItem } from '../cart/service.ts'
import { placeOrder } from '../checkout/service.ts'
import {
  cancelOwnOrder,
  dispatchLines,
  markShipmentDelivered,
  recordCancellationRefund,
} from '../orders/fulfilment.ts'
import { getAdminOrder } from '../orders/views.ts'
import { handleRazorpayWebhook } from '../payments/service.ts'
import {
  approveReturn,
  getReturn,
  listOwnReturns,
  listReturns,
  listSellerReturns,
  openReturn,
  recordReturnRefund,
  rejectReturn,
} from './service.ts'

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'returns-test')
  pools.push(pool)
  return createDatabase(pool)
}
const web = connect(requireEnv('DATABASE_URL'))
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))
const photos = { publicUrl: (key: string) => `https://cdn.test/${key}` }

type Buyer = Extract<RequestContext, { role: 'buyer' }>
type Seller = Extract<RequestContext, { role: 'seller' }>
type Admin = Extract<RequestContext, { role: 'admin' }>

const RETURN_WINDOW_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

let queue: JobQueue
let fake: FakeRazorpay
let razorpay: Razorpay
let seller: Seller
let otherSeller: Seller
let admin: Admin
let categoryId: string

beforeAll(async () => {
  await saveTestSettings(owner)
  await owner
    .insert(platformSettings)
    .values({ key: 'return_window_days', value: RETURN_WINDOW_DAYS })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: { value: RETURN_WINDOW_DAYS },
    })
  queue = await startJobQueue(requireEnv('DATABASE_URL'), 'returns-test')
  fake = await startFakeRazorpay()
  razorpay = createRazorpay(fake.config)
  const [first, second, category, administrator] = await Promise.all([
    createTestInvoicingSeller(owner),
    createTestInvoicingSeller(owner),
    createTestCategory(owner),
    createTestUser(owner, 'admin'),
  ])
  seller = { role: 'seller', userId: first.owner.id, sellerId: first.seller.id }
  otherSeller = {
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

const deps = () => ({ queue, photos })
const as = <T>(
  context: RequestContext,
  work: (tx: Transaction) => Promise<T>,
) => withContext(web, context, work)

/**
 * A buyer's order of `quantity` units at ₹500 each, paid and delivered,
 * and the line to return.
 */
async function delivered(
  options: { quantity?: number; paymentMethod?: 'cod' | 'razorpay' } = {},
) {
  const user = await createTestUser(owner)
  const address = await createTestAddress(owner, { userId: user.id })
  const buyer: Buyer = { role: 'buyer', userId: user.id }
  const { product, variant } = await createTestProduct(owner, {
    sellerId: seller.sellerId,
    categoryId,
  })
  await owner
    .update(productVariants)
    .set({ pricePaise: 50_000, mrpPaise: 60_000, stock: 10 })
    .where(eq(productVariants.id, variant.id))
  await withContext(web, buyer, (tx) =>
    addCartItem(tx, buyer, photos, {
      variantId: variant.id,
      quantity: options.quantity ?? 2,
    }),
  )
  const placed = await placeOrder(
    web,
    { queue, razorpay },
    buyer,
    { name: 'Asha Patil', email: user.email, phoneNumber: null },
    { addressId: address.id, paymentMethod: options.paymentMethod ?? 'cod' },
  )
  if (placed.payment) {
    const paid = fake.pay(placed.payment.razorpayOrderId)
    await handleRazorpayWebhook(
      web,
      { queue, razorpay },
      fake.webhook('payment.captured', paid),
    )
  }
  const [line] = await owner
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, placed.order.id))
  const sent = await dispatchLines(web, deps(), seller, placed.order.id, {
    lineIds: [line!.id],
    courierName: 'Delhivery',
    trackingNumber: 'DLV1234567',
  })
  const shipmentId = sent.lines[0]!.shipment!.id
  await markShipmentDelivered(web, seller, shipmentId)
  return {
    buyer,
    email: user.email,
    order: placed.order,
    lineId: line!.id,
    variantId: variant.id,
    productId: product.id,
    shipmentId,
  }
}

/** A photo the worker has already checked, ready to send with a return. */
async function checkedPhoto(buyer: Buyer): Promise<string> {
  const id = randomUUID()
  await owner.insert(returnPhotos).values({
    id,
    userId: buyer.userId,
    uploadKey: `uploads/returns/${buyer.userId}/${randomUUID()}`,
    status: 'ready',
    storageKey: `returns/${id}`,
    contentHash: 'a'.repeat(64),
    width: 1200,
    height: 900,
  })
  return id
}

const open = (buyer: Buyer, input: Record<string, unknown>) =>
  openReturn(web, { photos }, buyer, input)

const lineStatus = async (lineId: string) =>
  (
    await owner
      .select({ status: orderItems.status })
      .from(orderItems)
      .where(eq(orderItems.id, lineId))
  )[0]!.status

const stockOf = async (variantId: string) =>
  (
    await owner
      .select({ stock: productVariants.stock })
      .from(productVariants)
      .where(eq(productVariants.id, variantId))
  )[0]!.stock

const paymentStatus = async (orderId: string) =>
  (
    await owner
      .select({ status: payments.status })
      .from(payments)
      .where(eq(payments.orderId, orderId))
  )[0]!.status

const refund = (returnId: string, input: Record<string, unknown>) =>
  recordReturnRefund(web, deps(), admin, returnId, input)

describe('opening a return', () => {
  test('of part of a delivered line, with a photo', async () => {
    const { buyer, lineId, order } = await delivered({ quantity: 2 })
    const photo = await checkedPhoto(buyer)
    const view = await open(buyer, {
      orderItemId: lineId,
      quantity: 1,
      reasonCode: 'damaged',
      reasonText: 'The lid is cracked',
      photoIds: [photo],
    })
    expect(view).toMatchObject({
      status: 'requested',
      orderNumber: order.orderNumber,
      quantity: 1,
      reasonCode: 'damaged',
      reasonText: 'The lid is cracked',
      photoIds: [photo],
      buyerName: 'Asha Patil',
      sellerName: expect.any(String),
      maxRefundPaise: 50_000,
      refund: null,
      item: expect.objectContaining({
        lineQuantity: 2,
        unitPricePaise: 50_000,
      }),
    })
    expect(await lineStatus(lineId)).toBe('return_requested')
    await expect(
      open(buyer, { orderItemId: lineId, reasonCode: 'defective' }),
    ).rejects.toThrow(ConflictError)
  })

  test('is refused before delivery, after the window, and for too many', async () => {
    const { buyer, lineId, shipmentId } = await delivered({ quantity: 2 })
    await expect(
      open(buyer, { orderItemId: lineId, quantity: 3, reasonCode: 'damaged' }),
    ).rejects.toThrow(
      new ValidationError('That return cannot be sent', [
        'quantity must be at most 2',
      ]),
    )
    await expect(
      open(buyer, { orderItemId: lineId, reasonCode: 'other' }),
    ).rejects.toThrow(
      new ValidationError('That return cannot be sent', [
        'reasonText is required when the reason is other',
      ]),
    )
    await owner
      .update(shipments)
      .set({
        deliveredAt: new Date(Date.now() - (RETURN_WINDOW_DAYS + 1) * DAY_MS),
      })
      .where(eq(shipments.id, shipmentId))
    await expect(
      open(buyer, { orderItemId: lineId, reasonCode: 'damaged' }),
    ).rejects.toThrow(/the 7-day return window has closed$/)

    const stranger: Buyer = {
      role: 'buyer',
      userId: (await createTestUser(owner)).id,
    }
    await expect(
      open(stranger, { orderItemId: lineId, reasonCode: 'damaged' }),
    ).rejects.toThrow(NotFoundError)
    await expect(
      openReturn(web, { photos }, seller, {
        orderItemId: lineId,
        reasonCode: 'damaged',
      }),
    ).rejects.toThrow(ForbiddenError)
  })

  test('is refused for a line that has not arrived', async () => {
    const user = await createTestUser(owner)
    const address = await createTestAddress(owner, { userId: user.id })
    const buyer: Buyer = { role: 'buyer', userId: user.id }
    const { variant } = await createTestProduct(owner, {
      sellerId: seller.sellerId,
      categoryId,
    })
    await withContext(web, buyer, (tx) =>
      addCartItem(tx, buyer, photos, { variantId: variant.id, quantity: 1 }),
    )
    const placed = await placeOrder(
      web,
      { queue, razorpay },
      buyer,
      { name: 'Asha Patil', email: user.email, phoneNumber: null },
      { addressId: address.id, paymentMethod: 'cod' },
    )
    const [line] = await owner
      .select({ id: orderItems.id, title: orderItems.title })
      .from(orderItems)
      .where(eq(orderItems.orderId, placed.order.id))
    await expect(
      open(buyer, { orderItemId: line!.id, reasonCode: 'damaged' }),
    ).rejects.toThrow(
      new ConflictError(
        `${line!.title} can be returned once it has been delivered`,
      ),
    )
  })
})

describe('the administrator’s decision', () => {
  test('approves once, and a rejection gives the line back to the buyer', async () => {
    const { buyer, lineId } = await delivered()
    const first = await open(buyer, {
      orderItemId: lineId,
      reasonCode: 'damaged',
    })
    const approved = await approveReturn(web, deps(), admin, first.id, {
      note: 'Please pack it in its box',
    })
    expect(approved).toMatchObject({
      status: 'approved',
      adminNote: 'Please pack it in its box',
      decidedAt: expect.any(Date),
    })
    await expect(
      approveReturn(web, deps(), admin, first.id, {}),
    ).rejects.toThrow(new ConflictError('This return is already approved'))
    await expect(
      rejectReturn(web, deps(), admin, first.id, {}),
    ).rejects.toThrow(ValidationError)

    const rejected = await rejectReturn(
      web,
      deps(),
      admin,
      first.id,
      { note: 'The item never came back' },
      '203.0.113.5',
    )
    expect(rejected).toMatchObject({
      status: 'rejected',
      adminNote: 'The item never came back',
    })
    expect(await lineStatus(lineId)).toBe('delivered')
    const audit = await owner
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.entityId, first.id))
    expect(audit.map((entry) => entry.action).toSorted()).toEqual([
      'return.approve',
      'return.reject',
    ])
    const again = await open(buyer, {
      orderItemId: lineId,
      reasonCode: 'defective',
    })
    expect(again.status).toBe('requested')
  })

  test('is for administrators only', async () => {
    const { buyer, lineId } = await delivered()
    const opened = await open(buyer, {
      orderItemId: lineId,
      reasonCode: 'damaged',
    })
    await expect(
      approveReturn(web, deps(), seller, opened.id, {}),
    ).rejects.toThrow(ForbiddenError)
    await expect(
      rejectReturn(web, deps(), buyer, opened.id, { note: 'no' }),
    ).rejects.toThrow(ForbiddenError)
  })
})

describe('recording the refund', () => {
  test('of a cash on delivery line in two returns adds up to what was paid', async () => {
    const { buyer, email, lineId, order, variantId } = await delivered({
      quantity: 3,
    })
    expect(await stockOf(variantId)).toBe(7)
    const first = await open(buyer, {
      orderItemId: lineId,
      quantity: 1,
      reasonCode: 'no_longer_needed',
    })
    await expect(
      refund(first.id, { method: 'bank_transfer', amountPaise: 1, note: 'x' }),
    ).rejects.toThrow(
      new ConflictError('Approve this return before recording its refund'),
    )
    await approveReturn(web, deps(), admin, first.id, {})
    await expect(
      refund(first.id, {
        method: 'gateway',
        amountPaise: 50_000,
        razorpayRefundId: 'rfnd_FP8QHiV938haTz',
      }),
    ).rejects.toThrow(
      new ValidationError('That refund cannot be recorded', [
        'method must be bank_transfer for a cash on delivery order',
      ]),
    )
    await expect(
      refund(first.id, {
        method: 'bank_transfer',
        amountPaise: 50_001,
        note: 'UTR 4471',
      }),
    ).rejects.toThrow(
      new ConflictError('This return can be refunded at most ₹500'),
    )
    const refunded = await refund(first.id, {
      method: 'bank_transfer',
      amountPaise: 50_000,
      note: 'NEFT UTR SBIN0042',
    })
    expect(refunded).toMatchObject({
      status: 'refunded',
      refund: { amountPaise: 50_000, method: 'bank_transfer' },
    })
    expect(await lineStatus(lineId)).toBe('delivered')
    expect(await stockOf(variantId)).toBe(8)
    expect(await paymentStatus(order.id)).toBe('partially_refunded')

    const rest = await open(buyer, {
      orderItemId: lineId,
      reasonCode: 'no_longer_needed',
    })
    expect(rest).toMatchObject({ quantity: 2, maxRefundPaise: 100_000 })
    await approveReturn(web, deps(), admin, rest.id, {})
    await refund(rest.id, {
      method: 'bank_transfer',
      amountPaise: 100_000,
      note: 'NEFT UTR SBIN0043',
    })
    expect(await lineStatus(lineId)).toBe('returned')
    expect(await stockOf(variantId)).toBe(10)
    await expect(
      open(buyer, { orderItemId: lineId, reasonCode: 'damaged' }),
    ).rejects.toThrow(ConflictError)
    // ₹1,500 of goods plus nothing for delivery, all refunded.
    expect(order.totalPaise).toBe(150_000)
    expect(await paymentStatus(order.id)).toBe('refunded')

    const sent = await owner
      .select({ template: emailOutbox.template, payload: emailOutbox.payload })
      .from(emailOutbox)
      .where(
        and(
          eq(emailOutbox.toEmail, email),
          eq(emailOutbox.template, 'refund_recorded'),
        ),
      )
    expect(sent.map((row) => row.payload)).toEqual([
      expect.objectContaining({ amountPaise: 50_000, method: 'bank_transfer' }),
      expect.objectContaining({ amountPaise: 100_000 }),
    ])
  })

  test('through Razorpay records each refund id once', async () => {
    const one = await delivered({ quantity: 1, paymentMethod: 'razorpay' })
    const two = await delivered({ quantity: 1, paymentMethod: 'razorpay' })
    const returns = []
    for (const { buyer, lineId } of [one, two]) {
      const opened = await open(buyer, {
        orderItemId: lineId,
        reasonCode: 'wrong_item',
      })
      await approveReturn(web, deps(), admin, opened.id, {})
      returns.push(opened.id)
    }
    await expect(
      refund(returns[0]!, {
        method: 'gateway',
        amountPaise: 50_000,
        razorpayRefundId: 'refund-42',
      }),
    ).rejects.toThrow(ValidationError)
    await refund(returns[0]!, {
      method: 'gateway',
      amountPaise: 50_000,
      razorpayRefundId: 'rfnd_FP8QHiV938haTz',
    })
    // ₹500 ships free, so this refunds the whole payment.
    expect(await paymentStatus(one.order.id)).toBe('refunded')
    await expect(
      refund(returns[1]!, {
        method: 'gateway',
        amountPaise: 50_000,
        razorpayRefundId: 'rfnd_FP8QHiV938haTz',
      }),
    ).rejects.toThrow(
      new ConflictError('That Razorpay refund is already recorded'),
    )
  })
})

describe('who sees returns', () => {
  test('the buyer and the seller see their own, administrators the queue', async () => {
    const { buyer, lineId } = await delivered()
    const opened = await open(buyer, {
      orderItemId: lineId,
      reasonCode: 'damaged',
    })

    const own = await as(buyer, (tx) => listOwnReturns(tx, buyer, photos))
    expect(own.items.map((item) => item.id)).toEqual([opened.id])

    const forSeller = await as(seller, (tx) =>
      listSellerReturns(tx, seller, photos, {
        status: 'requested',
        limit: 100,
      }),
    )
    expect(forSeller.items.map((item) => item.id)).toContain(opened.id)
    const forOther = await as(otherSeller, (tx) =>
      listSellerReturns(tx, otherSeller, photos),
    )
    expect(forOther.items).toEqual([])
    await expect(
      as(otherSeller, (tx) => getReturn(tx, otherSeller, photos, opened.id)),
    ).rejects.toThrow(NotFoundError)

    const queued: string[] = []
    let cursor: string | undefined
    do {
      const page = await as(admin, (tx) =>
        listReturns(tx, admin, photos, { cursor, limit: 100 }),
      )
      queued.push(...page.items.map((item) => item.id))
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    // Other test files can add requests to this shared administrator queue.
    expect(queued).toContain(opened.id)
    expect(new Set(queued).size).toBe(queued.length)
    await expect(
      as(buyer, (tx) => listReturns(tx, buyer, photos)),
    ).rejects.toThrow(ForbiddenError)
    await expect(
      as(admin, (tx) => listReturns(tx, admin, photos, { status: 'lost' })),
    ).rejects.toThrow(ValidationError)
  })
})

describe('the refund of a cancelled paid order', () => {
  test('is the whole payment, recorded once', async () => {
    const user = await createTestUser(owner)
    const address = await createTestAddress(owner, { userId: user.id })
    const buyer: Buyer = { role: 'buyer', userId: user.id }
    const { variant } = await createTestProduct(owner, {
      sellerId: seller.sellerId,
      categoryId,
    })
    await withContext(web, buyer, (tx) =>
      addCartItem(tx, buyer, photos, { variantId: variant.id, quantity: 1 }),
    )
    const placed = await placeOrder(
      web,
      { queue, razorpay },
      buyer,
      { name: 'Asha Patil', email: user.email, phoneNumber: null },
      { addressId: address.id, paymentMethod: 'razorpay' },
    )
    const paid = fake.pay(placed.payment!.razorpayOrderId)
    await handleRazorpayWebhook(
      web,
      { queue, razorpay },
      fake.webhook('payment.captured', paid),
    )
    await cancelOwnOrder(web, deps(), buyer, placed.order.id, {})
    const total = placed.order.totalPaise

    await expect(
      recordCancellationRefund(web, deps(), admin, placed.order.id, {
        method: 'gateway',
        amountPaise: total - 1,
        razorpayRefundId: 'rfnd_Aa1Bb2Cc3Dd4Ee',
      }),
    ).rejects.toThrow(ValidationError)
    const view = await recordCancellationRefund(
      web,
      deps(),
      admin,
      placed.order.id,
      {
        method: 'gateway',
        amountPaise: total,
        razorpayRefundId: 'rfnd_Aa1Bb2Cc3Dd4Ee',
      },
    )
    expect(view).toMatchObject({
      needsRefund: false,
      paymentState: 'refunded',
    })
    expect(view.events.map((event) => event.eventType)).toContain(
      'refund_recorded',
    )
    await expect(
      recordCancellationRefund(web, deps(), admin, placed.order.id, {
        method: 'gateway',
        amountPaise: total,
        razorpayRefundId: 'rfnd_Zz9Yy8Xx7Ww6Vv',
      }),
    ).rejects.toThrow(ConflictError)
    const again = await as(admin, (tx) =>
      getAdminOrder(tx, admin, photos, placed.order.id),
    )
    expect(again.needsRefund).toBe(false)
  })
})
