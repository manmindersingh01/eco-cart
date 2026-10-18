import { createDatabase, createPool, requireEnv } from '@ecokart/core'
import {
  createTestCategory,
  createTestProduct,
  createTestSeller,
  createTestUser,
} from '@ecokart/core/testing'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { closePool } from '@/lib/db'
import { closeJobQueue } from '@/lib/queue'
import { apiRequest as request, withId } from '@/testing/requests'
import { signInWithEmail } from '@/testing/sign-in'
import { PATCH as decide } from '../../../admin/reviews/[id]/route'
import { GET as adminList } from '../../../admin/reviews/route'
import { GET as mine, PATCH as changeMine } from './mine/route'
import { GET as list, POST as write } from './route'

/*
 * The review routes (backend spec step 16), called the way Next.js calls
 * them for a browser. The rules are tested in packages/core; these prove
 * each route's answers.
 */

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'reviews-route-test',
)
const owner = createDatabase(ownerPool)

let slug: string
let buyerCookie: string
let otherBuyerCookie: string
let sellerCookie: string
let adminCookie: string

beforeAll(async () => {
  const [{ seller, owner: sellerOwner }, category, admin] = await Promise.all([
    createTestSeller(owner),
    createTestCategory(owner),
    createTestUser(owner, 'admin'),
  ])
  slug = (
    await createTestProduct(owner, {
      sellerId: seller.id,
      categoryId: category.id,
    })
  ).product.slug
  ;[buyerCookie, otherBuyerCookie, sellerCookie, adminCookie] =
    await Promise.all([
      signInWithEmail(owner, `${crypto.randomUUID()}@example.test`),
      signInWithEmail(owner, `${crypto.randomUUID()}@example.test`),
      signInWithEmail(owner, sellerOwner.email),
      signInWithEmail(owner, admin.email),
    ])
})

afterAll(async () => {
  await closeJobQueue()
  await closePool()
  await ownerPool.end()
})

const withSlug = (value: string) => ({
  params: Promise.resolve({ slug: value }),
})
const reviewShape = z
  .object({
    id: z.string(),
    rating: z.number(),
    authorName: z.string(),
    status: z.string(),
    verifiedPurchase: z.boolean(),
  })
  .loose()
const reviewResponse = z.object({ review: reviewShape })
const pageResponse = z.object({
  items: z.array(reviewShape.omit({ status: true })),
  nextCursor: z.string().nullable(),
})

const post = (body: unknown, cookie?: string) =>
  write(
    request(`/products/${slug}/reviews`, {
      method: 'POST',
      body,
      ...(cookie ? { cookie } : {}),
    }),
    withSlug(slug),
  )

describe('POST /api/products/{slug}/reviews', () => {
  test('401 signed out, 403 for a seller or administrator', async () => {
    const body = { rating: 5, authorName: 'Priya' }
    expect((await post(body)).status).toBe(401)
    expect((await post(body, sellerCookie)).status).toBe(403)
    expect((await post(body, adminCookie)).status).toBe(403)
  })

  test('saves a buyer’s review once, then 409', async () => {
    const created = await post(
      { rating: 4, authorName: 'Priya S.', title: 'Sturdy' },
      buyerCookie,
    )
    expect(created.status).toBe(201)
    expect(reviewResponse.parse(await created.json()).review).toMatchObject({
      rating: 4,
      authorName: 'Priya S.',
      status: 'published',
      verifiedPurchase: false,
    })
    const again = await post({ rating: 1, authorName: 'Priya S.' }, buyerCookie)
    expect(again.status).toBe(409)
  })

  test('400 for details it cannot use, 404 for a product not on sale', async () => {
    const invalid = await post({ rating: 9 }, otherBuyerCookie)
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toEqual({
      error: 'Those review details are not valid',
      issues: ['rating must be at most 5', 'authorName is required'],
    })
    const missing = await write(
      request('/products/no-such-product/reviews', {
        method: 'POST',
        cookie: otherBuyerCookie,
        body: { rating: 3, authorName: 'Ravi' },
      }),
      withSlug('no-such-product'),
    )
    expect(missing.status).toBe(404)
  })
})

describe('GET /api/products/{slug}/reviews', () => {
  test('answers the published reviews to anyone, a page at a time', async () => {
    await post({ rating: 5, authorName: 'Arjun' }, otherBuyerCookie)
    const response = await list(
      request(`/products/${slug}/reviews?limit=1`),
      withSlug(slug),
    )
    expect(response.status).toBe(200)
    const page = pageResponse.parse(await response.json())
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({ authorName: 'Arjun' })
    expect(typeof page.nextCursor).toBe('string')

    const invalid = await list(
      request(`/products/${slug}/reviews?limit=all`),
      withSlug(slug),
    )
    expect(invalid.status).toBe(400)
  })
})

describe('/api/products/{slug}/reviews/mine', () => {
  test('the buyer reads and changes their own review', async () => {
    const own = await mine(
      request(`/products/${slug}/reviews/mine`, { cookie: buyerCookie }),
      withSlug(slug),
    )
    expect(own.status).toBe(200)
    expect(reviewResponse.parse(await own.json()).review.rating).toBe(4)

    const changed = await changeMine(
      request(`/products/${slug}/reviews/mine`, {
        method: 'PATCH',
        cookie: buyerCookie,
        body: { rating: 3 },
      }),
      withSlug(slug),
    )
    expect(changed.status).toBe(200)
    expect(reviewResponse.parse(await changed.json()).review.rating).toBe(3)
  })

  test('404 for a buyer without a review, 401 signed out', async () => {
    const stranger = await signInWithEmail(
      owner,
      `${crypto.randomUUID()}@example.test`,
    )
    const none = await mine(
      request(`/products/${slug}/reviews/mine`, { cookie: stranger }),
      withSlug(slug),
    )
    expect(none.status).toBe(404)
    expect(await none.json()).toEqual({
      error: 'You have not reviewed this product yet',
    })
    const signedOut = await mine(
      request(`/products/${slug}/reviews/mine`),
      withSlug(slug),
    )
    expect(signedOut.status).toBe(401)
  })
})

describe('/api/admin/reviews', () => {
  test('administrators list reviews and hide one; others are refused', async () => {
    const hiddenBefore = await adminList(
      request('/admin/reviews?status=published&limit=100', {
        cookie: adminCookie,
      }),
    )
    expect(hiddenBefore.status).toBe(200)
    const { items } = z
      .object({ items: z.array(reviewShape) })
      .parse(await hiddenBefore.json())
    const target = items.find((item) => item.authorName === 'Arjun')!

    const hidden = await decide(
      request(`/admin/reviews/${target.id}`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { status: 'hidden' },
      }),
      withId(target.id),
    )
    expect(hidden.status).toBe(200)
    expect(reviewResponse.parse(await hidden.json()).review.status).toBe(
      'hidden',
    )

    const visible = pageResponse.parse(
      await (
        await list(request(`/products/${slug}/reviews`), withSlug(slug))
      ).json(),
    )
    expect(visible.items.map((item) => item.authorName)).not.toContain('Arjun')

    expect((await adminList(request('/admin/reviews'))).status).toBe(401)
    expect(
      (await adminList(request('/admin/reviews', { cookie: buyerCookie })))
        .status,
    ).toBe(403)
    const refused = await decide(
      request(`/admin/reviews/${target.id}`, {
        method: 'PATCH',
        cookie: sellerCookie,
        body: { status: 'published' },
      }),
      withId(target.id),
    )
    expect(refused.status).toBe(403)
  })
})
