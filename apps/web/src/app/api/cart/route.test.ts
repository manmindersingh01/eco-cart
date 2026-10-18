import { createDatabase, createPool, requireEnv, schema } from '@ecokart/core'
import {
  createTestCategory,
  createTestCoupon,
  createTestProduct,
  createTestSeller,
  createTestUser,
  saveTestSettings,
} from '@ecokart/core/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { closePool } from '@/lib/db'
import { closeJobQueue } from '@/lib/queue'
import { apiRequest } from '@/testing/requests'
import { signInWithEmail } from '@/testing/sign-in'
import { PUT as useCoupon } from './coupon/route'
import {
  DELETE as removeItem,
  PATCH as setItem,
} from './items/[variantId]/route'
import { POST as addItem } from './items/route'
import { GET as getCart } from './route'

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'cart-route-test',
)
const owner = createDatabase(ownerPool)

let sellerCookie: string
let adminCookie: string
let adminId: string
let sellerId: string
let categoryId: string

beforeAll(async () => {
  await saveTestSettings(owner)
  const [seller, admin, category] = await Promise.all([
    createTestSeller(owner),
    createTestUser(owner, 'admin'),
    createTestCategory(owner),
  ])
  sellerId = seller.seller.id
  adminId = admin.id
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

const cartResponse = z.object({
  cart: z
    .object({
      lines: z.array(
        z.object({ variantId: z.string(), quantity: z.number() }).loose(),
      ),
      totalPaise: z.number(),
    })
    .loose(),
})

async function newVariant() {
  const { variant } = await createTestProduct(owner, { sellerId, categoryId })
  return variant.id
}

/** The cart cookie a response sets, as `name=value`, or undefined. */
const cartCookieIn = (response: Response) =>
  response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith('ecokart.cart='))

const request = (
  path: string,
  options: { method?: string; cookie?: string; body?: unknown } = {},
) => apiRequest(path, options)

const withVariant = (variantId: string) => ({
  params: Promise.resolve({ variantId }),
})

describe('a guest cart through the API', () => {
  test('the first add sets a cookie that finds the cart again', async () => {
    const variantId = await newVariant()
    expect(cartCookieIn(await getCart(request('/cart')))).toBeUndefined()

    const added = await addItem(
      request('/cart/items', {
        method: 'POST',
        body: { variantId, quantity: 2 },
      }),
    )
    expect(added.status).toBe(200)
    const setCookie = cartCookieIn(added)
    expect(setCookie).toMatch(
      /^ecokart\.cart=[\w-]{43}; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Lax$/,
    )
    const cookie = setCookie!.split(';')[0]!

    const cart = cartResponse.parse(
      await (await getCart(request('/cart', { cookie }))).json(),
    ).cart
    expect(cart.lines).toEqual([
      expect.objectContaining({ variantId, quantity: 2 }),
    ])
    expect(cart.totalPaise).toBe(100_000)

    const changed = await setItem(
      request(`/cart/items/${variantId}`, {
        method: 'PATCH',
        cookie,
        body: { quantity: 1 },
      }),
      withVariant(variantId),
    )
    // ₹500 is above the ₹499 free-delivery threshold.
    expect(cartResponse.parse(await changed.json()).cart.totalPaise).toBe(
      50_000,
    )
    const removed = await removeItem(
      request(`/cart/items/${variantId}`, { method: 'DELETE', cookie }),
      withVariant(variantId),
    )
    expect(cartResponse.parse(await removed.json()).cart.lines).toEqual([])
  })

  test('answers in plain words when an item cannot be added', async () => {
    const variantId = await newVariant()
    const tooMany = await addItem(
      request('/cart/items', {
        method: 'POST',
        body: { variantId, quantity: 6 },
      }),
    )
    expect(tooMany.status).toBe(409)
    expect(await tooMany.json()).toEqual({
      error: expect.stringMatching(/^Only 5 of Bamboo bottle \w+ are left$/),
    })
    // A refused request leaves the visitor without a cookie.
    expect(cartCookieIn(tooMany)).toBeUndefined()

    const malformed = await addItem(
      request('/cart/items', { method: 'POST', body: { variantId: 'x' } }),
    )
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toEqual({
      error: 'That item cannot be added',
      issues: ['variantId must be a product variant id'],
    })
  })

  test('uses a coupon, and 404 for one that does not exist', async () => {
    const variantId = await newVariant()
    const coupon = await createTestCoupon(owner, adminId)
    const added = await addItem(
      request('/cart/items', {
        method: 'POST',
        body: { variantId, quantity: 2 },
      }),
    )
    const cookie = cartCookieIn(added)!.split(';')[0]!
    const used = await useCoupon(
      request('/cart/coupon', {
        method: 'PUT',
        cookie,
        body: { code: coupon.code },
      }),
    )
    expect(cartResponse.parse(await used.json()).cart.totalPaise).toBe(90_000)
    const missing = await useCoupon(
      request('/cart/coupon', {
        method: 'PUT',
        cookie,
        body: { code: 'NOPE' },
      }),
    )
    expect(missing.status).toBe(404)
  })
})

describe('signing in with a guest cart', () => {
  test('moves the cart into the account and clears the cookie', async () => {
    const variantId = await newVariant()
    const added = await addItem(
      request('/cart/items', { method: 'POST', body: { variantId } }),
    )
    const guestCookie = cartCookieIn(added)!.split(';')[0]!
    const email = `${crypto.randomUUID()}@example.test`
    const session = await signInWithEmail(owner, email)

    const response = await getCart(
      request('/cart', { cookie: `${session}; ${guestCookie}` }),
    )
    expect(cartResponse.parse(await response.json()).cart.lines).toEqual([
      expect.objectContaining({ variantId, quantity: 1 }),
    ])
    expect(cartCookieIn(response)).toMatch(
      /^ecokart\.cart=; Path=\/; Max-Age=0;/,
    )

    const [buyer] = await owner
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email))
    const [cart] = await owner
      .select()
      .from(schema.carts)
      .where(eq(schema.carts.userId, buyer!.id))
    expect(cart?.guestToken).toBeNull()
    const again = await getCart(request('/cart', { cookie: session }))
    expect(cartResponse.parse(await again.json()).cart.lines).toHaveLength(1)
  })
})

describe('who has a cart', () => {
  test.each([
    ['a seller', () => sellerCookie],
    ['an administrator', () => adminCookie],
  ])('403 for %s', async (_who, cookie) => {
    const response = await getCart(request('/cart', { cookie: cookie() }))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: 'This needs a buyer account',
    })
  })
})
