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
import { POST as approve } from '../../admin/returns/[id]/approve/route'
import { POST as refund } from '../../admin/returns/[id]/refund/route'
import { POST as reject } from '../../admin/returns/[id]/reject/route'
import { GET as adminQueue } from '../../admin/returns/route'
import { POST as addItem } from '../../cart/items/route'
import { POST as placeOrder } from '../../checkout/route'
import { POST as dispatch } from '../../seller/orders/[id]/shipments/route'
import { GET as getSellerReturn } from '../../seller/returns/[id]/route'
import { GET as sellerReturns } from '../../seller/returns/route'
import { POST as markDelivered } from '../../seller/shipments/[id]/delivered/route'
import { GET as getOwnReturn } from './[id]/route'
import { POST as openReturn, GET as ownReturns } from './route'

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'returns-route-test',
)
const owner = createDatabase(ownerPool)

let sellerId: string
let sellerCookie: string
let otherSellerCookie: string
let adminCookie: string
let categoryId: string

beforeAll(async () => {
  await saveTestSettings(owner)
  await owner
    .insert(schema.platformSettings)
    .values({ key: 'return_window_days', value: 7 })
    .onConflictDoUpdate({
      target: schema.platformSettings.key,
      set: { value: 7 },
    })
  const [seller, other, admin, category] = await Promise.all([
    createTestInvoicingSeller(owner),
    createTestInvoicingSeller(owner),
    createTestUser(owner, 'admin'),
    createTestCategory(owner),
  ])
  sellerId = seller.seller.id
  categoryId = category.id
  ;[sellerCookie, otherSellerCookie, adminCookie] = await Promise.all([
    signInWithEmail(owner, seller.owner.email),
    signInWithEmail(owner, other.owner.email),
    signInWithEmail(owner, admin.email),
  ])
})

afterAll(async () => {
  await closeJobQueue()
  await closePool()
  await ownerPool.end()
})

const orderShape = z.object({
  order: z
    .object({
      id: z.string(),
      lines: z.array(
        z
          .object({
            id: z.string(),
            shipment: z.object({ id: z.string() }).loose().nullable(),
          })
          .loose(),
      ),
    })
    .loose(),
})
const returnShape = z.object({
  return: z.object({ id: z.string(), status: z.string() }).loose(),
})
const pageShape = z.object({
  items: z.array(z.object({ id: z.string() }).loose()),
  nextCursor: z.string().nullable(),
})

/** A signed-in buyer whose cash on delivery order of one item arrived. */
async function deliveredLine() {
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
  const placed = await placeOrder(
    apiRequest('/checkout', {
      method: 'POST',
      cookie,
      body: { addressId: address.id, paymentMethod: 'cod' },
    }),
  )
  const orderId = z
    .object({ order: z.object({ id: z.string() }) })
    .parse(await placed.json()).order.id
  const [line] = await owner
    .select({ id: schema.orderItems.id })
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, orderId))
  const sent = orderShape.parse(
    await (
      await dispatch(
        apiRequest(`/seller/orders/${orderId}/shipments`, {
          method: 'POST',
          cookie: sellerCookie,
          body: {
            lineIds: [line!.id],
            courierName: 'Delhivery',
            trackingNumber: 'DLV1234567',
          },
        }),
        withId(orderId),
      )
    ).json(),
  )
  const parcel = sent.order.lines[0]!.shipment!.id
  await markDelivered(
    apiRequest(`/seller/shipments/${parcel}/delivered`, {
      method: 'POST',
      cookie: sellerCookie,
    }),
    withId(parcel),
  )
  return { cookie, lineId: line!.id }
}

const post = (path: string, cookie: string, body?: unknown) =>
  apiRequest(path, {
    method: 'POST',
    cookie,
    ...(body === undefined ? {} : { body }),
  })

describe('a return from request to refund', () => {
  test('the buyer asks, the administrator approves and refunds, the seller sees it', async () => {
    const { cookie, lineId } = await deliveredLine()
    const opened = await openReturn(
      post('/account/returns', cookie, {
        orderItemId: lineId,
        reasonCode: 'damaged',
      }),
    )
    expect(opened.status).toBe(201)
    const { return: created } = returnShape.parse(await opened.json())
    expect(created.status).toBe('requested')

    const queue = pageShape.parse(
      await (
        await adminQueue(
          apiRequest('/admin/returns?limit=100', { cookie: adminCookie }),
        )
      ).json(),
    )
    expect(queue.items.map((item) => item.id)).toContain(created.id)

    const approved = await approve(
      post(`/admin/returns/${created.id}/approve`, adminCookie),
      withId(created.id),
    )
    expect(approved.status).toBe(200)

    const refunded = await refund(
      post(`/admin/returns/${created.id}/refund`, adminCookie, {
        method: 'bank_transfer',
        amountPaise: 50_000,
        note: 'NEFT UTR SBIN0042',
      }),
      withId(created.id),
    )
    expect(refunded.status).toBe(200)
    expect(returnShape.parse(await refunded.json()).return).toMatchObject({
      status: 'refunded',
      refund: { amountPaise: 50_000, method: 'bank_transfer' },
    })

    const forSeller = await getSellerReturn(
      apiRequest(`/seller/returns/${created.id}`, { cookie: sellerCookie }),
      withId(created.id),
    )
    expect(returnShape.parse(await forSeller.json()).return).toMatchObject({
      status: 'refunded',
      refund: null,
    })
    const notTheirs = await getSellerReturn(
      apiRequest(`/seller/returns/${created.id}`, {
        cookie: otherSellerCookie,
      }),
      withId(created.id),
    )
    expect(notTheirs.status).toBe(404)

    const own = pageShape.parse(
      await (
        await ownReturns(apiRequest('/account/returns', { cookie }))
      ).json(),
    )
    expect(own.items.map((item) => item.id)).toEqual([created.id])
    const one = await getOwnReturn(
      apiRequest(`/account/returns/${created.id}`, { cookie }),
      withId(created.id),
    )
    expect(one.status).toBe(200)
  })

  test('a rejection needs a reason, and a refund needs an approval', async () => {
    const { cookie, lineId } = await deliveredLine()
    const { return: created } = returnShape.parse(
      await (
        await openReturn(
          post('/account/returns', cookie, {
            orderItemId: lineId,
            reasonCode: 'no_longer_needed',
          }),
        )
      ).json(),
    )
    const early = await refund(
      post(`/admin/returns/${created.id}/refund`, adminCookie, {
        method: 'bank_transfer',
        amountPaise: 50_000,
        note: 'NEFT',
      }),
      withId(created.id),
    )
    expect(early.status).toBe(409)
    const noReason = await reject(
      post(`/admin/returns/${created.id}/reject`, adminCookie, {}),
      withId(created.id),
    )
    expect(noReason.status).toBe(400)
    expect(await noReason.json()).toEqual({
      error: 'That return cannot be rejected',
      issues: ['note is required'],
    })
    const rejected = await reject(
      post(`/admin/returns/${created.id}/reject`, adminCookie, {
        note: 'Used items cannot be returned',
      }),
      withId(created.id),
    )
    expect(returnShape.parse(await rejected.json()).return.status).toBe(
      'rejected',
    )
  })
})

describe('who may use these routes', () => {
  test('each role only its own', async () => {
    const { cookie } = await deliveredLine()
    expect((await ownReturns(apiRequest('/account/returns'))).status).toBe(401)
    expect(
      (
        await ownReturns(
          apiRequest('/account/returns', { cookie: sellerCookie }),
        )
      ).status,
    ).toBe(403)
    expect(
      (await sellerReturns(apiRequest('/seller/returns', { cookie }))).status,
    ).toBe(403)
    expect(
      (await adminQueue(apiRequest('/admin/returns', { cookie }))).status,
    ).toBe(403)
    const badStatus = await sellerReturns(
      apiRequest('/seller/returns?status=lost', { cookie: sellerCookie }),
    )
    expect(badStatus.status).toBe(400)
  })
})
