import {
  createDatabase,
  createPool,
  requireEnv,
  screenListing,
} from '@ecokart/core'
import {
  createTestCategory,
  createTestPhoto,
  createTestSeller,
  createTestUser,
  testDatabase,
} from '@ecokart/core/testing'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { PUT as saveSetting } from '@/app/api/admin/settings/[key]/route'
import { POST as archive } from '@/app/api/seller/products/[id]/archive/route'
import { POST as moveToDraft } from '@/app/api/seller/products/[id]/move-to-draft/route'
import {
  GET as getOwnProduct,
  PATCH as patchProduct,
} from '@/app/api/seller/products/[id]/route'
import { POST as submit } from '@/app/api/seller/products/[id]/submit/route'
import { POST as createProduct } from '@/app/api/seller/products/route'
import { closePool } from '@/lib/db'
import { closeJobQueue } from '@/lib/queue'
import { apiRequest as request, withId } from '@/testing/requests'
import { signInWithEmail } from '@/testing/sign-in'
import { POST as approve } from '../products/[id]/approve/route'
import { POST as reject } from '../products/[id]/reject/route'
import { GET as getForReview } from '../products/[id]/route'
import { POST as takeDown } from '../products/[id]/take-down/route'
import { GET as listQueue } from './route'

/*
 * Listing moderation through the API (backend spec step 7): a seller submits,
 * the screening job runs, and an administrator works through the queue.
 */

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'moderation-route-test',
)
const owner = createDatabase(ownerPool)
const workerPool = createPool(
  testDatabase('web').workerUrl,
  'moderation-route-test-worker',
)
const worker = createDatabase(workerPool)

let sellerCookie: string
let otherSellerCookie: string
let buyerCookie: string
let adminCookie: string
let categoryId: string

beforeAll(async () => {
  const [seller, other, admin] = await Promise.all([
    createTestSeller(owner),
    createTestSeller(owner),
    createTestUser(owner, 'admin'),
  ])
  sellerCookie = await signInWithEmail(owner, seller.owner.email)
  otherSellerCookie = await signInWithEmail(owner, other.owner.email)
  buyerCookie = await signInWithEmail(
    owner,
    `${crypto.randomUUID()}@example.test`,
  )
  adminCookie = await signInWithEmail(owner, admin.email)
  // GST 18% with the default HSN code 3924.
  categoryId = (await createTestCategory(owner)).id
})

afterAll(async () => {
  await closeJobQueue()
  await closePool()
  await Promise.all([ownerPool.end(), workerPool.end()])
})

const productBody = z.object({
  product: z
    .object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      gstRateBps: z.number().nullable(),
      hsnCode: z.string().nullable(),
      rejectionReason: z.string().nullable(),
    })
    .loose(),
})
const reviewBody = productBody.extend({
  seller: z.object({ id: z.string(), status: z.string() }).loose(),
  reviews: z.array(
    z
      .object({
        id: z.string(),
        risk: z.string().nullable(),
        decision: z.string().nullable(),
        reason: z.string().nullable(),
      })
      .loose(),
  ),
})
const queueBody = z.object({
  items: z.array(
    z
      .object({
        reviewId: z.string(),
        risk: z.string().nullable(),
        flags: z.array(z.object({ code: z.string(), detail: z.string() })),
        product: z.object({ id: z.string() }).loose(),
      })
      .loose(),
  ),
  nextCursor: z.string().nullable(),
})

/** A draft "Toy gun" listing at ₹499 (MRP ₹599), with a ready photo. */
async function draft(title = 'Wooden toy gun'): Promise<string> {
  const response = await createProduct(
    request('/seller/products', {
      method: 'POST',
      cookie: sellerCookie,
      body: {
        categoryId,
        title,
        description: 'Hand-carved from mango wood.',
        variants: [
          { sku: 'TOY-1', pricePaise: 49_900, mrpPaise: 59_900, stock: 10 },
        ],
      },
    }),
  )
  expect(response.status).toBe(201)
  const { id } = productBody.parse(await response.json()).product
  await createTestPhoto(owner, id)
  return id
}

const post = (
  handler: (
    request: Request,
    route: ReturnType<typeof withId>,
  ) => Promise<Response>,
  path: string,
  id: string,
  cookie?: string,
  body?: unknown,
) =>
  handler(
    request(path, {
      method: 'POST',
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { body }),
    }),
    withId(id),
  )

const submitAs = (id: string, cookie?: string) =>
  post(submit, `/seller/products/${id}/submit`, id, cookie)
const approveAs = (id: string, body: unknown, cookie = adminCookie) =>
  post(approve, `/admin/products/${id}/approve`, id, cookie, body)
const rejectAs = (id: string, body: unknown, cookie = adminCookie) =>
  post(reject, `/admin/products/${id}/reject`, id, cookie, body)
const takeDownAs = (id: string, body: unknown, cookie = adminCookie) =>
  post(takeDown, `/admin/products/${id}/take-down`, id, cookie, body)
const moveToDraftAs = (id: string, cookie?: string) =>
  post(moveToDraft, `/seller/products/${id}/move-to-draft`, id, cookie)
const statusOf = async (response: Response) =>
  productBody.parse(await response.json()).product.status

async function reviewOf(id: string) {
  const response = await getForReview(
    request(`/admin/products/${id}`, { cookie: adminCookie }),
    withId(id),
  )
  expect(response.status).toBe(200)
  return reviewBody.parse(await response.json())
}

/** Runs the screening job of the product's open review, as the worker does. */
async function screen(id: string): Promise<void> {
  const [open] = (await reviewOf(id)).reviews
  await screenListing({ db: worker }, open!.id)
}

async function queuePage(query = '', cookie = adminCookie) {
  return listQueue(request(`/admin/moderation${query}`, { cookie }))
}

describe('a listing through review', () => {
  test('flagged, rejected, fixed, approved, and archived', async () => {
    const saved = await saveSetting(
      request('/admin/settings/prohibited_terms', {
        method: 'PUT',
        cookie: adminCookie,
        body: { value: ['gun'] },
      }),
      { params: Promise.resolve({ key: 'prohibited_terms' }) },
    )
    expect(saved.status).toBe(200)

    const id = await draft()
    const submitted = await submitAs(id, sellerCookie)
    expect(submitted.status).toBe(200)
    expect(productBody.parse(await submitted.json()).product.status).toBe(
      'pending_review',
    )
    await screen(id)

    // The administrator finds it among the high-risk reviews.
    const high = queueBody.parse(await (await queuePage('?risk=high')).json())
    expect(high.items.find((item) => item.product.id === id)).toMatchObject({
      risk: 'high',
      flags: [
        { code: 'prohibited_term', detail: '"gun" appears in the title' },
      ],
    })

    const rejected = await rejectAs(id, {
      reason: 'Toy weapons cannot be sold on EcoKart',
    })
    expect(rejected.status).toBe(200)
    expect(reviewBody.parse(await rejected.json()).product).toMatchObject({
      status: 'rejected',
      rejectionReason: 'Toy weapons cannot be sold on EcoKart',
    })

    // The seller sees why, changes the title, and submits again.
    const seen = await getOwnProduct(
      request(`/seller/products/${id}`, { cookie: sellerCookie }),
      withId(id),
    )
    expect(productBody.parse(await seen.json()).product.rejectionReason).toBe(
      'Toy weapons cannot be sold on EcoKart',
    )
    const fixed = await patchProduct(
      request(`/seller/products/${id}`, {
        method: 'PATCH',
        cookie: sellerCookie,
        body: { title: 'Wooden toy elephant' },
      }),
      withId(id),
    )
    expect(fixed.status).toBe(200)
    expect((await submitAs(id, sellerCookie)).status).toBe(200)
    await screen(id)
    const low = queueBody.parse(await (await queuePage('?risk=low')).json())
    expect(low.items.map((item) => item.product.id)).toContain(id)

    const approved = await approveAs(id, {})
    expect(approved.status).toBe(200)
    const review = reviewBody.parse(await approved.json())
    expect(review.product).toMatchObject({
      status: 'approved',
      gstRateBps: 1800,
      hsnCode: '3924',
      rejectionReason: null,
    })
    expect(review.reviews.map((entry) => entry.decision)).toEqual([
      'approved',
      'rejected',
    ])

    const archived = await post(
      archive,
      `/seller/products/${id}/archive`,
      id,
      sellerCookie,
    )
    expect(archived.status).toBe(200)
    expect(productBody.parse(await archived.json()).product.status).toBe(
      'archived',
    )
  })
})

describe('a listing after approval', () => {
  test('taken down, fixed, moved back to draft from sale, and withdrawn from review', async () => {
    const id = await draft('Bamboo soap dish')
    await submitAs(id, sellerCookie)
    await screen(id)
    expect((await approveAs(id, {})).status).toBe(200)

    const taken = await takeDownAs(id, {
      reason: 'The photo shows a plastic dish',
    })
    expect(taken.status).toBe(200)
    expect(reviewBody.parse(await taken.json()).product).toMatchObject({
      status: 'rejected',
      rejectionReason: 'The photo shows a plastic dish',
    })
    expect(await statusOf(await submitAs(id, sellerCookie))).toBe(
      'pending_review',
    )
    await screen(id)
    expect((await approveAs(id, {})).status).toBe(200)

    // Back to draft from sale, then submitted and withdrawn again.
    expect(await statusOf(await moveToDraftAs(id, sellerCookie))).toBe('draft')
    expect(await statusOf(await submitAs(id, sellerCookie))).toBe(
      'pending_review',
    )
    expect(await statusOf(await moveToDraftAs(id, sellerCookie))).toBe('draft')
    expect(
      (await reviewOf(id)).reviews.map((review) => review.decision),
    ).toEqual(['withdrawn', 'approved', 'approved'])
  })

  test('the answers: 401, 403, 404, 400, and 409', async () => {
    const id = await draft('Bamboo coaster')
    expect((await moveToDraftAs(id)).status).toBe(401)
    expect((await moveToDraftAs(id, buyerCookie)).status).toBe(403)
    expect((await moveToDraftAs(id, otherSellerCookie)).status).toBe(404)
    const already = await moveToDraftAs(id, sellerCookie)
    expect(already.status).toBe(409)
    expect(await already.json()).toEqual({
      error: 'This listing can already be changed',
    })

    const notOnSale = await takeDownAs(id, { reason: 'Fake listing' })
    expect(notOnSale.status).toBe(409)
    expect(await notOnSale.json()).toEqual({
      error: 'Only a listing that is on sale can be taken down',
    })
    expect((await takeDownAs(id, {})).status).toBe(400)
    expect(
      (await takeDownAs(id, { reason: 'Fake listing' }, sellerCookie)).status,
    ).toBe(403)
  })
})

describe('the answers', () => {
  test('submitting: 401, 403, 404, 400 with what to fix, and 409', async () => {
    const id = await draft('Bamboo comb')
    expect((await submitAs(id)).status).toBe(401)
    expect((await submitAs(id, buyerCookie)).status).toBe(403)
    expect((await submitAs(id, otherSellerCookie)).status).toBe(404)

    const created = await createProduct(
      request('/seller/products', {
        method: 'POST',
        cookie: sellerCookie,
        body: {
          categoryId,
          title: 'Bamboo comb without a photo',
          variants: [
            { sku: 'COMB-1', pricePaise: 9_900, mrpPaise: 9_900, stock: 5 },
          ],
        },
      }),
    )
    const photoless = productBody.parse(await created.json()).product.id
    const notReady = await submitAs(photoless, sellerCookie)
    expect(notReady.status).toBe(400)
    expect(await notReady.json()).toEqual({
      error: 'This listing cannot be submitted for review yet',
      issues: ['Add at least one photo; the storefront needs a main image'],
    })

    expect((await submitAs(id, sellerCookie)).status).toBe(200)
    const again = await submitAs(id, sellerCookie)
    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({
      error: 'This listing is already waiting for review',
    })
  })

  test('deciding: 400 for a bad body, 409 before screening or when not waiting', async () => {
    const id = await draft('Bamboo cup')
    expect((await approveAs(id, {})).status).toBe(409)
    await submitAs(id, sellerCookie)

    const early = await approveAs(id, {})
    expect(early.status).toBe(409)
    expect(await early.json()).toEqual({
      error: 'Screening has not finished yet; try again in a moment',
    })
    await screen(id)

    const notJson = await approve(
      new Request(`http://localhost:3000/api/admin/products/${id}/approve`, {
        method: 'POST',
        headers: { cookie: adminCookie },
      }),
      withId(id),
    )
    expect(notJson.status).toBe(400)
    expect((await approveAs(id, { gstRateBps: 1200 })).status).toBe(400)
    const noReason = await rejectAs(id, {})
    expect(noReason.status).toBe(400)
    expect(await noReason.json()).toEqual({
      error: 'That rejection is not valid',
      issues: ['reason is required'],
    })
    expect((await approveAs(id, {}, sellerCookie)).status).toBe(403)

    expect((await approveAs(id, { gstRateBps: 500 })).status).toBe(200)
    expect((await rejectAs(id, { reason: 'Too late' })).status).toBe(409)
    // Archiving needs a listing on sale.
    const draftId = await draft('Bamboo plate')
    expect(
      (
        await post(
          archive,
          `/seller/products/${draftId}/archive`,
          draftId,
          sellerCookie,
        )
      ).status,
    ).toBe(409)
  })

  test('the queue and one product: administrators only', async () => {
    expect((await queuePage('', '')).status).toBe(401)
    expect((await queuePage('', sellerCookie)).status).toBe(403)
    const badRisk = await queuePage('?risk=urgent')
    expect(badRisk.status).toBe(400)
    expect(await badRisk.json()).toEqual({
      error: 'risk must be one of high, medium, low',
      issues: [],
    })
    expect((await queuePage('?cursor=nonsense')).status).toBe(400)
    const page = queueBody.parse(await (await queuePage('?limit=1')).json())
    expect(page.items.length).toBeLessThanOrEqual(1)

    const missing = crypto.randomUUID()
    expect(
      (
        await getForReview(
          request(`/admin/products/${missing}`, { cookie: adminCookie }),
          withId(missing),
        )
      ).status,
    ).toBe(404)
    expect(
      (
        await getForReview(
          request(`/admin/products/${missing}`, { cookie: sellerCookie }),
          withId(missing),
        )
      ).status,
    ).toBe(403)
  })
})
