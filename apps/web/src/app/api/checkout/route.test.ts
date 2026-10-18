import { createDatabase, createPool, requireEnv, schema } from '@ecokart/core'
import {
  createTestAddress,
  createTestCategory,
  createTestInvoicingSeller,
  createTestProduct,
  createTestUser,
  saveTestSettings,
  startFakeRazorpay,
  type FakeRazorpay,
} from '@ecokart/core/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { closePool } from '@/lib/db'
import { closeJobQueue } from '@/lib/queue'
import { apiRequest } from '@/testing/requests'
import { signInWithEmail } from '@/testing/sign-in'
import { POST as addItem } from '../cart/items/route'
import { POST as webhook } from '../webhooks/razorpay/route'
import { POST as confirmPayment } from './payment/route'
import { GET as getOptions, POST as placeOrder } from './route'

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'checkout-route-test',
)
const owner = createDatabase(ownerPool)

let fake: FakeRazorpay
let sellerId: string
let categoryId: string
let sellerCookie: string

beforeAll(async () => {
  fake = await startFakeRazorpay()
  // Read on first use by src/lib/razorpay.ts.
  process.env.RAZORPAY_KEY_ID = fake.config.keyId
  process.env.RAZORPAY_KEY_SECRET = fake.config.keySecret
  process.env.RAZORPAY_WEBHOOK_SECRET = fake.config.webhookSecret
  process.env.RAZORPAY_API_URL = fake.config.apiUrl
  await saveTestSettings(owner)
  const [seller, category] = await Promise.all([
    createTestInvoicingSeller(owner),
    createTestCategory(owner),
  ])
  sellerId = seller.seller.id
  categoryId = category.id
  sellerCookie = await signInWithEmail(owner, seller.owner.email)
})

afterAll(async () => {
  await closeJobQueue()
  await closePool()
  await ownerPool.end()
  await fake.close()
})

/** A signed-in buyer with a saved address and one item in the cart. */
async function buyerWithCart(quantity = 2) {
  const user = await createTestUser(owner)
  const address = await createTestAddress(owner, { userId: user.id })
  const cookie = await signInWithEmail(owner, user.email)
  const { variant } = await createTestProduct(owner, { sellerId, categoryId })
  await owner
    .update(schema.productVariants)
    .set({ pricePaise: 50_000, mrpPaise: 60_000, stock: 5 })
    .where(eq(schema.productVariants.id, variant.id))
  const added = await addItem(
    apiRequest('/cart/items', {
      method: 'POST',
      cookie,
      body: { variantId: variant.id, quantity },
    }),
  )
  expect(added.status).toBe(200)
  return { user, cookie, addressId: address.id, variantId: variant.id }
}

const checkout = (cookie: string, body: unknown) =>
  placeOrder(apiRequest('/checkout', { method: 'POST', cookie, body }))

/** A webhook delivery as Razorpay sends it. */
const deliver = (
  delivery: { rawBody: string; signature: string; eventId: string },
  headers: Record<string, string> = {},
) =>
  webhook(
    new Request('http://localhost:3000/api/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': delivery.signature,
        'x-razorpay-event-id': delivery.eventId,
        ...headers,
      },
      body: delivery.rawBody,
    }),
  )

describe('GET /api/checkout', () => {
  test('lists the ways a buyer can pay', async () => {
    const { cookie } = await buyerWithCart()
    const response = await getOptions(apiRequest('/checkout', { cookie }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      cashOnDelivery: true,
      online: { keyId: fake.config.keyId },
    })
  })

  test('is only for buyers', async () => {
    expect((await getOptions(apiRequest('/checkout'))).status).toBe(401)
    const response = await getOptions(
      apiRequest('/checkout', { cookie: sellerCookie }),
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: 'This needs a buyer account',
    })
  })
})

describe('POST /api/checkout', () => {
  test('places a cash on delivery order and empties the cart', async () => {
    const { user, cookie, addressId } = await buyerWithCart()
    const response = await checkout(cookie, {
      addressId,
      paymentMethod: 'cod',
      expectedTotalPaise: 100_000,
    })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      order: {
        id: expect.any(String),
        orderNumber: expect.stringMatching(/^EK-\d{6}-\d{6,}$/),
        status: 'confirmed',
        paymentMethod: 'cod',
        totalPaise: 100_000,
      },
      payment: null,
    })
    const [order] = await owner
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.userId, user.id))
    expect(order).toMatchObject({
      buyerName: user.name,
      buyerEmail: user.email,
    })
    const again = await checkout(cookie, { addressId, paymentMethod: 'cod' })
    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({ error: 'Your cart is empty' })
  })

  test('answers 400 with the field that is wrong', async () => {
    const { cookie, addressId } = await buyerWithCart()
    const response = await checkout(cookie, {
      addressId,
      paymentMethod: 'cheque',
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Those checkout details are not valid',
      issues: ['paymentMethod must be one of razorpay, cod'],
    })
  })

  test('answers 503 and keeps the cart when Razorpay cannot start the payment', async () => {
    const { cookie, addressId } = await buyerWithCart()
    fake.failNextOrder(500)
    const response = await checkout(cookie, {
      addressId,
      paymentMethod: 'razorpay',
    })
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error:
        'Online payment could not be started. Your cart is as it was; please try again, or choose cash on delivery.',
    })
    const retried = await checkout(cookie, { addressId, paymentMethod: 'cod' })
    expect(retried.status).toBe(201)
  })
})

const placedOrder = z.object({
  order: z.object({
    id: z.string(),
    orderNumber: z.string(),
    status: z.string(),
  }),
  payment: z.object({
    razorpayOrderId: z.string(),
    keyId: z.string(),
    amountPaise: z.number(),
  }),
})

/** An online order waiting for payment. */
async function pendingOrder() {
  const buyer = await buyerWithCart()
  const response = await checkout(buyer.cookie, {
    addressId: buyer.addressId,
    paymentMethod: 'razorpay',
  })
  expect(response.status).toBe(201)
  const placed = placedOrder.parse(await response.json())
  expect(placed.order.status).toBe('pending_payment')
  expect(placed.payment).toMatchObject({
    keyId: fake.config.keyId,
    amountPaise: 100_000,
  })
  return { ...buyer, placed }
}

describe('paying online', () => {
  test('the browser return confirms the order', async () => {
    const { cookie, placed } = await pendingOrder()
    const paid = fake.pay(placed.payment.razorpayOrderId)
    const response = await confirmPayment(
      apiRequest('/checkout/payment', {
        method: 'POST',
        cookie,
        body: fake.checkoutReturn(paid),
      }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      orderId: placed.order.id,
      orderNumber: placed.order.orderNumber,
      status: 'confirmed',
    })
  })

  test('a forged browser return is refused', async () => {
    const { cookie, placed } = await pendingOrder()
    const paid = fake.pay(placed.payment.razorpayOrderId)
    const response = await confirmPayment(
      apiRequest('/checkout/payment', {
        method: 'POST',
        cookie,
        body: {
          ...fake.checkoutReturn(paid),
          razorpaySignature: 'a'.repeat(64),
        },
      }),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: 'The payment signature is not valid',
    })
  })

  test('the webhook confirms the order once and answers 200 to a replay', async () => {
    const { placed } = await pendingOrder()
    const paid = fake.pay(placed.payment.razorpayOrderId)
    const delivery = fake.webhook('payment.captured', paid)
    const first = await deliver(delivery)
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ outcome: 'confirmed' })
    const replay = await deliver(delivery)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual({ outcome: 'replay' })
    const [order] = await owner
      .select({ status: schema.orders.status })
      .from(schema.orders)
      .where(eq(schema.orders.id, placed.order.id))
    expect(order?.status).toBe('confirmed')
  })

  test('the webhook refuses a delivery that is not signed by Razorpay', async () => {
    const { placed } = await pendingOrder()
    const paid = fake.pay(placed.payment.razorpayOrderId)
    const delivery = fake.webhook('payment.captured', paid)
    const forged = await deliver({ ...delivery, signature: 'b'.repeat(64) })
    expect(forged.status).toBe(400)
    expect(await forged.json()).toEqual({
      error: 'The webhook signature is not valid',
      issues: [],
    })
    const huge = await deliver({
      ...delivery,
      rawBody: `${delivery.rawBody}${' '.repeat(300 * 1024)}`,
    })
    expect(huge.status).toBe(400)
    expect(await huge.json()).toEqual({
      error: 'The webhook body is too large',
      issues: [],
    })
  })
})
