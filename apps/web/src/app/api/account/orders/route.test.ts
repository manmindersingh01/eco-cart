import { createDatabase, createPool, requireEnv, schema } from '@ecokart/core'
import {
  createTestAddress,
  createTestCategory,
  createTestInvoicingSeller,
  createTestProduct,
  createTestUser,
  saveTestSettings,
} from '@ecokart/core/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { closePool } from '@/lib/db'
import { closeJobQueue } from '@/lib/queue'
import { apiRequest, withId } from '@/testing/requests'
import { signInWithEmail } from '@/testing/sign-in'
import { POST as cancelAsAdmin } from '../../admin/orders/[id]/cancel/route'
import { GET as getAdminOrder } from '../../admin/orders/[id]/route'
import { GET as listAdminOrders } from '../../admin/orders/route'
import { POST as markDeliveredAsAdmin } from '../../admin/shipments/[id]/delivered/route'
import { POST as addItem } from '../../cart/items/route'
import { POST as placeOrder } from '../../checkout/route'
import { GET as getSellerOrder } from '../../seller/orders/[id]/route'
import { POST as dispatch } from '../../seller/orders/[id]/shipments/route'
import { GET as listSellerOrders } from '../../seller/orders/route'
import { POST as markDelivered } from '../../seller/shipments/[id]/delivered/route'
import { POST as cancelOwn } from './[id]/cancel/route'
import { GET as getOwnOrder } from './[id]/route'
import { GET as listOwnOrders } from './route'

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'orders-route-test',
)
const owner = createDatabase(ownerPool)

let sellerId: string
let sellerCookie: string
let adminCookie: string
let categoryId: string

beforeAll(async () => {
  await saveTestSettings(owner)
  const [seller, admin, category] = await Promise.all([
    createTestInvoicingSeller(owner),
    createTestUser(owner, 'admin'),
    createTestCategory(owner),
  ])
  sellerId = seller.seller.id
  categoryId = category.id
  ;[sellerCookie, adminCookie] = await Promise.all([
    signInWithEmail(owner, seller.owner.email),
    signInWithEmail(owner, admin.email),
  ])
})

afterAll(async () => {
  await closeJobQueue()
  await closePool()
  await ownerPool.end()
})

const placedShape = z.object({
  order: z.object({ id: z.string(), orderNumber: z.string() }),
})
const orderShape = z.object({
  order: z
    .object({
      id: z.string(),
      status: z.string(),
      progress: z.string().optional(),
      lines: z.array(
        z
          .object({
            id: z.string(),
            status: z.string(),
            shipment: z.object({ id: z.string() }).loose().nullable(),
          })
          .loose(),
      ),
    })
    .loose(),
})
const pageShape = z.object({
  items: z.array(z.object({ id: z.string() }).loose()),
  nextCursor: z.string().nullable(),
})

/** A signed-in buyer with a cash on delivery order of one item. */
async function buyerWithOrder() {
  const user = await createTestUser(owner)
  const address = await createTestAddress(owner, { userId: user.id })
  const cookie = await signInWithEmail(owner, user.email)
  const { variant } = await createTestProduct(owner, { sellerId, categoryId })
  await owner
    .update(schema.productVariants)
    .set({ pricePaise: 50_000, mrpPaise: 60_000, stock: 5 })
    .where(eq(schema.productVariants.id, variant.id))
  await addItem(
    apiRequest('/cart/items', {
      method: 'POST',
      cookie,
      body: { variantId: variant.id, quantity: 1 },
    }),
  )
  const response = await placeOrder(
    apiRequest('/checkout', {
      method: 'POST',
      cookie,
      body: { addressId: address.id, paymentMethod: 'cod' },
    }),
  )
  expect(response.status).toBe(201)
  const { order } = placedShape.parse(await response.json())
  return { cookie, order }
}

describe('an order from checkout to the door', () => {
  test('the buyer sees it, the seller dispatches and delivers it, and it completes', async () => {
    const { cookie, order } = await buyerWithOrder()

    const list = await listOwnOrders(apiRequest('/account/orders', { cookie }))
    expect(list.status).toBe(200)
    expect(pageShape.parse(await list.json()).items[0]?.id).toBe(order.id)

    const queued = await listSellerOrders(
      apiRequest('/seller/orders?tab=to_dispatch&limit=100', {
        cookie: sellerCookie,
      }),
    )
    expect(
      pageShape.parse(await queued.json()).items.map((item) => item.id),
    ).toContain(order.id)
    const forSeller = orderShape.parse(
      await (
        await getSellerOrder(
          apiRequest(`/seller/orders/${order.id}`, { cookie: sellerCookie }),
          withId(order.id),
        )
      ).json(),
    )

    const sent = await dispatch(
      apiRequest(`/seller/orders/${order.id}/shipments`, {
        method: 'POST',
        cookie: sellerCookie,
        body: {
          lineIds: forSeller.order.lines.map((line) => line.id),
          courierName: 'Delhivery',
          trackingNumber: 'DLV1234567',
        },
      }),
      withId(order.id),
    )
    expect(sent.status).toBe(201)
    const dispatched = orderShape.parse(await sent.json())
    const parcelId = dispatched.order.lines[0]!.shipment!.id

    const refused = await cancelOwn(
      apiRequest(`/account/orders/${order.id}/cancel`, {
        method: 'POST',
        cookie,
      }),
      withId(order.id),
    )
    expect(refused.status).toBe(409)

    const delivered = await markDelivered(
      apiRequest(`/seller/shipments/${parcelId}/delivered`, {
        method: 'POST',
        cookie: sellerCookie,
      }),
      withId(parcelId),
    )
    expect(delivered.status).toBe(200)
    const seen = orderShape.parse(
      await (
        await getOwnOrder(
          apiRequest(`/account/orders/${order.id}`, { cookie }),
          withId(order.id),
        )
      ).json(),
    )
    expect(seen.order).toMatchObject({
      status: 'completed',
      progress: 'delivered',
      paymentState: 'paid',
    })
  })

  test('the buyer cancels without giving a reason', async () => {
    const { cookie, order } = await buyerWithOrder()
    const response = await cancelOwn(
      apiRequest(`/account/orders/${order.id}/cancel`, {
        method: 'POST',
        cookie,
      }),
      withId(order.id),
    )
    expect(response.status).toBe(200)
    expect(orderShape.parse(await response.json()).order).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Cancelled by the buyer',
    })
  })
})

describe('administrators', () => {
  test('find an order by number, read it, cancel it, and mark parcels delivered', async () => {
    const { order } = await buyerWithOrder()
    const found = await listAdminOrders(
      apiRequest(`/admin/orders?orderNumber=${order.orderNumber}`, {
        cookie: adminCookie,
      }),
    )
    expect(pageShape.parse(await found.json()).items).toEqual([
      expect.objectContaining({ id: order.id, needsRefund: false }),
    ])
    const detail = await getAdminOrder(
      apiRequest(`/admin/orders/${order.id}`, { cookie: adminCookie }),
      withId(order.id),
    )
    expect(detail.status).toBe(200)

    const noReason = await cancelAsAdmin(
      apiRequest(`/admin/orders/${order.id}/cancel`, {
        method: 'POST',
        cookie: adminCookie,
        body: {},
      }),
      withId(order.id),
    )
    expect(noReason.status).toBe(400)
    expect(await noReason.json()).toEqual({
      error: 'Those cancellation details are not valid',
      issues: ['reason is required'],
    })
    const cancelled = await cancelAsAdmin(
      apiRequest(`/admin/orders/${order.id}/cancel`, {
        method: 'POST',
        cookie: adminCookie,
        body: { reason: 'The seller cannot supply it' },
      }),
      withId(order.id),
    )
    expect(cancelled.status).toBe(200)

    const missing = await markDeliveredAsAdmin(
      apiRequest(`/admin/shipments/${order.id}/delivered`, {
        method: 'POST',
        cookie: adminCookie,
      }),
      withId(order.id),
    )
    expect(missing.status).toBe(404)
  })
})

describe('who may use these routes', () => {
  test('each role only its own', async () => {
    const { cookie, order } = await buyerWithOrder()
    expect((await listOwnOrders(apiRequest('/account/orders'))).status).toBe(
      401,
    )
    expect(
      (
        await listOwnOrders(
          apiRequest('/account/orders', { cookie: sellerCookie }),
        )
      ).status,
    ).toBe(403)
    expect(
      (await listSellerOrders(apiRequest('/seller/orders', { cookie }))).status,
    ).toBe(403)
    expect(
      (await listAdminOrders(apiRequest('/admin/orders', { cookie }))).status,
    ).toBe(403)
    const stranger = await buyerWithOrder()
    const notTheirs = await getOwnOrder(
      apiRequest(`/account/orders/${order.id}`, { cookie: stranger.cookie }),
      withId(order.id),
    )
    expect(notTheirs.status).toBe(404)
    const badTab = await listSellerOrders(
      apiRequest('/seller/orders?tab=lost', { cookie: sellerCookie }),
    )
    expect(badTab.status).toBe(400)
  })
})
