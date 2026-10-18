import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDatabase, type Transaction } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import {
  auditLogs,
  brands,
  categories,
  productImages,
  productModeration,
  productVariants,
  products,
} from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import { ConflictError, ForbiddenError, NotFoundError } from '../../errors.ts'
import { encodeCursor } from '../../lib/pagination.ts'
import { startJobQueue, type JobQueue } from '../../lib/queue.ts'
import { createObjectStorage, loadStorageConfig } from '../../lib/storage.ts'
import { validationIssues } from '../../testing/errors.ts'
import {
  createTestBrand,
  createTestCategory,
  createTestPhoto,
  createTestSeller,
  createTestUser,
} from '../../testing/fixtures.ts'
import { holdRows, sessionsWaitingOn, waitUntil } from '../../testing/locks.ts'
import { updateCategory } from './categories.ts'
import {
  approveProduct,
  archiveProduct,
  getProductForReview,
  listReviewQueue,
  moveToDraft,
  rejectProduct,
  submitProduct,
  takeDownProduct,
} from './moderation.ts'
import {
  createProduct,
  getOwnProduct,
  updateProduct,
  type SellerContext,
} from './products.ts'
import { SCREEN_LISTING_QUEUE, screenListing } from './screening.ts'
import type { ProductView, ReviewQueueItem } from './types.ts'

// Screening runs without AI here; its AI checks are tested in screening.test.ts.
const storage = createObjectStorage(loadStorageConfig())

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'moderation-test')
  pools.push(pool)
  return createDatabase(pool)
}
const web = connect(requireEnv('DATABASE_URL'))
const worker = connect(requireEnv('WORKER_DATABASE_URL'))
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))
const photos = { publicUrl: (key: string) => `https://images.test/${key}` }
const IP = '203.0.113.7'

let queue: JobQueue
let admin: Extract<RequestContext, { role: 'admin' }>
let seller: SellerContext
let category: { id: string; name: string }

beforeAll(async () => {
  queue = await startJobQueue(requireEnv('DATABASE_URL'), 'moderation-test')
  admin = { role: 'admin', userId: (await createTestUser(owner, 'admin')).id }
  seller = await newSeller()
  // GST 18% with the default HSN code 3924.
  category = await createTestCategory(owner)
})

afterAll(async () => {
  await queue.stop()
  await Promise.all(pools.map((pool) => pool.end()))
})

async function newSeller(
  status: 'pending' | 'approved' = 'approved',
): Promise<SellerContext> {
  const { owner: user, seller: business } = await createTestSeller(
    owner,
    status,
  )
  return { role: 'seller', userId: user.id, sellerId: business.id }
}

const as = <T>(
  context: RequestContext,
  work: (tx: Transaction) => Promise<T>,
) => withContext(web, context, work)

/** Two sizes of a bamboo toothbrush at ₹199 (MRP ₹249). */
const toothbrush = (overrides: Record<string, unknown> = {}) => ({
  categoryId: category.id,
  title: 'Bamboo Toothbrush, Pack of 4',
  description: 'Biodegradable handles.',
  optionNames: ['Bristles'],
  variants: [
    {
      sku: 'BTB-SOFT',
      options: { Bristles: 'Soft' },
      pricePaise: 19_900,
      mrpPaise: 24_900,
      stock: 120,
    },
    {
      sku: 'BTB-MED',
      options: { Bristles: 'Medium' },
      pricePaise: 19_900,
      mrpPaise: 24_900,
      stock: 80,
    },
  ],
  ...overrides,
})

/** A draft with one ready photo, ready to submit. */
async function draft(
  overrides: Record<string, unknown> = {},
  context: SellerContext = seller,
): Promise<ProductView> {
  const product = await as(context, (tx) =>
    createProduct(tx, photos, context, toothbrush(overrides)),
  )
  await createTestPhoto(owner, product.id)
  return product
}

const submit = (productId: string, context: RequestContext = seller) =>
  as(context, (tx) => submitProduct(tx, photos, queue, context, productId))

const openReview = async (productId: string) =>
  (
    await owner
      .select()
      .from(productModeration)
      .where(
        and(
          eq(productModeration.productId, productId),
          isNull(productModeration.decision),
        ),
      )
  )[0]

const reviewsOf = (productId: string) =>
  owner
    .select()
    .from(productModeration)
    .where(eq(productModeration.productId, productId))
    .orderBy(asc(productModeration.createdAt))

/** Runs the screening job of the product's open review, as the worker does. */
async function screen(productId: string): Promise<void> {
  const review = await openReview(productId)
  if (!review) throw new Error(`Product ${productId} has no open review`)
  await screenListing({ db: worker, storage, ai: null }, review.id)
}

/** A listing that was submitted and screened, waiting for a decision. */
async function waiting(
  overrides: Record<string, unknown> = {},
): Promise<ProductView> {
  const product = await draft(overrides)
  await submit(product.id)
  await screen(product.id)
  return product
}

const approve = (
  productId: string,
  input: unknown = {},
  context: RequestContext = admin,
) =>
  as(context, (tx) => approveProduct(tx, photos, context, productId, input, IP))

const reject = (
  productId: string,
  input: unknown,
  context: RequestContext = admin,
) =>
  as(context, (tx) => rejectProduct(tx, photos, context, productId, input, IP))

const productRow = async (id: string) =>
  (await owner.select().from(products).where(eq(products.id, id)))[0]!

const auditOf = (entityType: string, entityId: string) =>
  owner
    .select({
      action: auditLogs.action,
      actorUserId: auditLogs.actorUserId,
      actorRole: auditLogs.actorRole,
      before: auditLogs.before,
      after: auditLogs.after,
      ip: auditLogs.ip,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.entityType, entityType),
        eq(auditLogs.entityId, entityId),
      ),
    )
    .orderBy(asc(auditLogs.id))

/**
 * What one of several racing calls came to: `done`, or the message of the
 * ConflictError it lost with. Anything else still fails the test.
 */
const outcomeOf = (attempt: Promise<unknown>, done: string) =>
  attempt.then(
    () => done,
    (error: unknown) => {
      if (error instanceof ConflictError) return error.message
      throw error
    },
  )

const archive = (productId: string, context: RequestContext = seller) =>
  as(context, (tx) => archiveProduct(tx, photos, context, productId))

const toDraft = (productId: string, context: RequestContext = seller) =>
  as(context, (tx) => moveToDraft(tx, photos, context, productId))

const takeDown = (
  productId: string,
  input: unknown,
  context: RequestContext = admin,
) =>
  as(context, (tx) =>
    takeDownProduct(tx, photos, context, productId, input, IP),
  )

const queuePage = (
  options: Parameters<typeof listReviewQueue>[3] = {},
  context: RequestContext = admin,
) => as(context, (tx) => listReviewQueue(tx, photos, context, options))

const reviewFor = (productId: string, context: RequestContext = admin) =>
  as(context, (tx) => getProductForReview(tx, photos, context, productId))

const visibleToVisitors = async (productId: string) =>
  (
    await as({ role: 'anonymous' }, (tx) =>
      tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.id, productId)),
    )
  ).length === 1

describe('submitProduct', () => {
  test('moves a draft to review, opens a review, and queues its screening', async () => {
    const product = await draft()
    const submitted = await submit(product.id)

    expect(submitted.status).toBe('pending_review')
    const review = await openReview(product.id)
    expect(review).toMatchObject({
      aiFlags: [],
      aiRisk: null,
      riskRank: 3,
      decision: null,
      decidedBy: null,
    })
    const jobs = await owner.execute<{ count: number }>(
      sql`select count(*)::int as count from pgboss.job where name = ${SCREEN_LISTING_QUEUE} and data->>'reviewId' = ${review!.id}`,
    )
    expect(jobs.rows[0]!.count).toBe(1)
    expect(await visibleToVisitors(product.id)).toBe(false)
  })

  test('refuses a listing that could not be sold, with everything to fix', async () => {
    const noHsn = await owner
      .insert(categories)
      .values({
        name: `No HSN ${randomUUID()}`,
        slug: `no-hsn-${randomUUID()}`,
        gstRateBps: 500,
      })
      .returning()
    const brand = await createTestBrand(owner)
    const product = await as(seller, (tx) =>
      createProduct(
        tx,
        photos,
        seller,
        toothbrush({ categoryId: noHsn[0]!.id, brandId: brand.id }),
      ),
    )
    await owner
      .update(productVariants)
      .set({ isActive: false })
      .where(eq(productVariants.productId, product.id))
    await owner
      .update(categories)
      .set({ isActive: false })
      .where(eq(categories.id, noHsn[0]!.id))
    await owner
      .update(brands)
      .set({ isActive: false })
      .where(eq(brands.id, brand.id))

    expect(await validationIssues(submit(product.id))).toEqual([
      'Add at least one photo; the storefront needs a main image',
      'Make at least one variant active; a listing needs a price',
      'hsnCode is required, because the category has no default HSN code',
      'categoryId is not active',
      'brandId is not active',
    ])
    expect((await productRow(product.id)).status).toBe('draft')
    expect(await reviewsOf(product.id)).toEqual([])
  })

  test('waits for photos still being processed, and ignores failed ones', async () => {
    const product = await draft()
    await createTestPhoto(owner, product.id, 'failed')
    const processing = await createTestPhoto(owner, product.id, 'processing')
    expect(await validationIssues(submit(product.id))).toEqual([
      'Wait until every photo has been processed, which takes a few seconds',
    ])

    await owner
      .update(productImages)
      .set({ status: 'ready', contentHash: 'h', width: 900, height: 900 })
      .where(eq(productImages.id, processing.id))
    await expect(submit(product.id)).resolves.toMatchObject({
      status: 'pending_review',
    })
  })

  test('takes the category default HSN code or the product’s own', async () => {
    const product = await draft({ hsnCode: '4419' })
    await expect(submit(product.id)).resolves.toMatchObject({
      status: 'pending_review',
    })
  })

  test('only a draft or rejected listing', async () => {
    const product = await draft()
    await submit(product.id)
    await expect(submit(product.id)).rejects.toThrow(
      new ConflictError('This listing is already waiting for review'),
    )
    for (const status of ['approved', 'archived'] as const) {
      await owner
        .update(products)
        .set({
          status,
          gstRateBps: 1800,
          hsnCode: '3924',
          publishedAt: new Date(),
        })
        .where(eq(products.id, product.id))
      await expect(submit(product.id)).rejects.toThrow(
        new ConflictError(
          'Only a draft or rejected listing can be submitted for review',
        ),
      )
    }
  })

  test('a seller still waiting for approval can submit', async () => {
    const pending = await newSeller('pending')
    const product = await draft({}, pending)
    await expect(submit(product.id, pending)).resolves.toMatchObject({
      status: 'pending_review',
    })
  })

  test('only the seller who owns the listing', async () => {
    const product = await draft()
    await expect(submit(product.id, await newSeller())).rejects.toThrow(
      NotFoundError,
    )
    await expect(submit(product.id, admin)).rejects.toThrow(
      new ForbiddenError('This needs a seller account'),
    )
    await expect(submit(randomUUID())).rejects.toThrow(NotFoundError)
    await expect(submit('not-an-id')).rejects.toThrow(NotFoundError)
  })

  test('two submits at the same moment open one review', async () => {
    const product = await draft()
    const { pid, release, finished } = await holdRows(
      owner,
      products,
      products.id,
      [product.id],
    )
    const attempts = [submit(product.id), submit(product.id)].map((attempt) =>
      outcomeOf(attempt, 'submitted'),
    )
    await waitUntil(async () => (await sessionsWaitingOn(owner, pid)) >= 2)
    release()
    await finished

    expect((await Promise.all(attempts)).toSorted()).toEqual([
      'This listing is already waiting for review',
      'submitted',
    ])
    expect(await reviewsOf(product.id)).toHaveLength(1)
  })
})

describe('approveProduct', () => {
  test('copies the category’s rate and HSN code, publishes, and audits', async () => {
    const product = await waiting()
    const review = await openReview(product.id)
    const decided = await approve(product.id)

    expect(decided.product).toMatchObject({
      status: 'approved',
      gstRateBps: 1800,
      hsnCode: '3924',
      rejectionReason: null,
    })
    expect(decided.product.publishedAt).toBeInstanceOf(Date)
    expect(decided.seller).toMatchObject({
      id: seller.sellerId,
      status: 'approved',
    })
    expect(decided.reviews).toEqual([
      expect.objectContaining({
        id: review!.id,
        risk: 'low',
        flags: [
          { code: 'ai_not_checked', detail: 'AI checks are switched off' },
        ],
        decision: 'approved',
        decidedBy: admin.userId,
        reason: null,
      }),
    ])
    expect(await auditOf('product', product.id)).toEqual([
      {
        action: 'product.approve',
        actorUserId: admin.userId,
        actorRole: 'admin',
        before: { status: 'pending_review', gstRateBps: null, hsnCode: null },
        after: {
          status: 'approved',
          gstRateBps: 1800,
          hsnCode: '3924',
          categoryGstRateBps: 1800,
          reviewId: review!.id,
        },
        ip: IP,
      },
    ])
    expect(await visibleToVisitors(product.id)).toBe(true)
  })

  test('an administrator may give another current rate; the product’s own HSN code stays', async () => {
    const product = await waiting({ hsnCode: '4419' })
    expect(
      await validationIssues(approve(product.id, { gstRateBps: 1200 })),
    ).toEqual([
      'gstRateBps must be one of the current GST rates in basis points: 0 (0%), 25 (0.25%), 300 (3%), 500 (5%), 1800 (18%), 4000 (40%)',
    ])
    const { product: approved } = await approve(product.id, {
      gstRateBps: 500,
    })
    expect(approved).toMatchObject({ gstRateBps: 500, hsnCode: '4419' })
  })

  test('waits until screening has finished', async () => {
    const product = await draft()
    await submit(product.id)
    await expect(approve(product.id)).rejects.toThrow(
      new ConflictError(
        'Screening has not finished yet; try again in a moment',
      ),
    )
    await screen(product.id)
    await expect(approve(product.id)).resolves.toBeDefined()
  })

  test('checks the listing again, because the catalogue may have changed', async () => {
    const own = await createTestCategory(owner)
    const product = await waiting({ categoryId: own.id })
    await owner
      .update(categories)
      .set({ isActive: false })
      .where(eq(categories.id, own.id))
    expect(await validationIssues(approve(product.id))).toEqual([
      'categoryId is not active',
    ])
    expect((await productRow(product.id)).status).toBe('pending_review')
  })

  test('a later approval keeps the first publication time and web address', async () => {
    const product = await waiting()
    const first = (await approve(product.id)).product
    // A listing taken off sale and sent back (a later step) comes back
    // through a new review.
    await owner
      .update(products)
      .set({ status: 'rejected', rejectionReason: 'Fix the photo' })
      .where(eq(products.id, product.id))
    await submit(product.id)
    await screen(product.id)
    const second = (await approve(product.id)).product
    expect(second.publishedAt).toEqual(first.publishedAt)
    expect(second.slug).toBe(first.slug)
    expect(await reviewsOf(product.id)).toHaveLength(2)
  })

  test('only for a listing waiting for review, and only by an administrator', async () => {
    const product = await draft()
    await expect(approve(product.id)).rejects.toThrow(
      new ConflictError('This listing is not waiting for review'),
    )
    await expect(approve(randomUUID())).rejects.toThrow(NotFoundError)
    await expect(approve('not-an-id')).rejects.toThrow(NotFoundError)
    await expect(approve(product.id, {}, seller)).rejects.toThrow(
      new ForbiddenError('Only administrators can review listings'),
    )
  })

  test('two administrators deciding at the same moment: one wins', async () => {
    const product = await waiting()
    const { pid, release, finished } = await holdRows(
      owner,
      products,
      products.id,
      [product.id],
    )
    const attempts = [
      outcomeOf(approve(product.id), 'decided'),
      outcomeOf(reject(product.id, { reason: 'Blurry photo' }), 'decided'),
    ]
    await waitUntil(async () => (await sessionsWaitingOn(owner, pid)) >= 2)
    release()
    await finished

    expect((await Promise.all(attempts)).toSorted()).toEqual([
      'This listing is not waiting for review',
      'decided',
    ])
    const reviews = await reviewsOf(product.id)
    expect(reviews).toHaveLength(1)
    expect((await productRow(product.id)).status).toBe(reviews[0]!.decision)
  })

  test('an approval during a category rate change gets the new rate', async () => {
    const own = await createTestCategory(owner)
    const product = await waiting({ categoryId: own.id })

    // An administrator changes the rate; the change has not committed yet.
    const changed = Promise.withResolvers<number>()
    const commit = Promise.withResolvers<void>()
    const change = as(admin, async (tx) => {
      await updateCategory(tx, admin, own.id, { gstRateBps: 500 })
      const result = await tx.execute<{ pid: number }>(
        sql`select pg_backend_pid() as pid`,
      )
      changed.resolve(result.rows[0]!.pid)
      await commit.promise
    })
    change.catch(changed.reject)
    const pid = await changed.promise
    const approval = approve(product.id)
    try {
      await waitUntil(async () => (await sessionsWaitingOn(owner, pid)) >= 1)
    } finally {
      commit.resolve()
      await change
    }

    expect((await approval).product.gstRateBps).toBe(500)
  })
})

describe('rejectProduct', () => {
  test('sends the listing back with a reason, before screening too', async () => {
    const product = await draft()
    await submit(product.id)
    const review = await openReview(product.id)
    const decided = await reject(product.id, {
      reason: 'The photo shows a different product',
    })

    expect(decided.product).toMatchObject({
      status: 'rejected',
      rejectionReason: 'The photo shows a different product',
    })
    expect(decided.reviews[0]).toMatchObject({
      id: review!.id,
      risk: null,
      decision: 'rejected',
      decidedBy: admin.userId,
      reason: 'The photo shows a different product',
    })
    expect(await auditOf('product', product.id)).toEqual([
      expect.objectContaining({
        action: 'product.reject',
        before: { status: 'pending_review' },
        after: {
          status: 'rejected',
          reason: 'The photo shows a different product',
          reviewId: review!.id,
        },
      }),
    ])
    // The seller sees why.
    expect(
      (await as(seller, (tx) => getOwnProduct(tx, photos, seller, product.id)))
        .rejectionReason,
    ).toBe('The photo shows a different product')
  })

  test('the seller fixes it and submits again, which opens a new review', async () => {
    const product = await waiting()
    await reject(product.id, { reason: 'Add the pack size to the title' })
    const resubmitted = await submit(product.id)
    expect(resubmitted).toMatchObject({
      status: 'pending_review',
      rejectionReason: null,
    })
    await screen(product.id)
    const { reviews } = await approve(product.id)
    expect(reviews.map((review) => review.decision)).toEqual([
      'approved',
      'rejected',
    ])
  })

  test('needs a reason', async () => {
    const product = await waiting()
    expect(await validationIssues(reject(product.id, {}))).toEqual([
      'reason is required',
    ])
    expect(
      await validationIssues(reject(product.id, { reason: 'x'.repeat(501) })),
    ).toEqual(['reason must be at most 500 characters'])
  })
})

describe('archiveProduct', () => {
  test('takes an approved listing off sale', async () => {
    const product = await waiting()
    await approve(product.id)
    expect(await archive(product.id)).toMatchObject({ status: 'archived' })
    expect(await visibleToVisitors(product.id)).toBe(false)
  })

  test('only a listing on sale, and only by its seller', async () => {
    const product = await draft()
    await expect(archive(product.id)).rejects.toThrow(
      new ConflictError('Only a listing that is on sale can be archived'),
    )
    await expect(archive(product.id, await newSeller())).rejects.toThrow(
      NotFoundError,
    )
    await expect(archive(product.id, admin)).rejects.toThrow(ForbiddenError)
  })
})

/** An open review with the given risk, submitted `minutes` from now. */
async function reviewWith(
  risk: 'high' | 'medium' | 'low' | null,
  minutes: number,
) {
  const product = await draft()
  await submit(product.id)
  const review = (await openReview(product.id))!
  await owner
    .update(productModeration)
    .set({
      aiRisk: risk,
      submittedAt: new Date(Date.now() + minutes * 60_000),
    })
    .where(eq(productModeration.id, review.id))
  return review.id
}

/** Every page of the queue, two reviews at a time. */
async function wholeQueue(
  options: { risk?: string } = {},
): Promise<ReviewQueueItem[]> {
  const items: ReviewQueueItem[] = []
  let cursor: string | undefined
  do {
    const page = await queuePage({
      ...options,
      limit: 2,
      ...(cursor ? { cursor } : {}),
    })
    items.push(...page.items)
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return items
}

describe('moveToDraft', () => {
  test('withdraws a listing waiting for review, so the seller can change it', async () => {
    const product = await draft()
    await submit(product.id)
    const review = await openReview(product.id)

    expect(await toDraft(product.id)).toMatchObject({ status: 'draft' })
    expect((await reviewsOf(product.id))[0]).toMatchObject({
      id: review!.id,
      decision: 'withdrawn',
      decidedBy: seller.userId,
      reason: null,
    })
    expect(
      (await wholeQueue()).some((item) => item.product.id === product.id),
    ).toBe(false)
    // A screening job that runs late leaves the withdrawn review alone.
    await screenListing({ db: worker, storage, ai: null }, review!.id)
    expect((await reviewsOf(product.id))[0]!.aiRisk).toBeNull()

    // Changed and submitted again, it opens a new review.
    await as(seller, (tx) =>
      updateProduct(tx, photos, seller, product.id, { title: 'Corrected' }),
    )
    await submit(product.id)
    expect((await reviewsOf(product.id)).map((row) => row.decision)).toEqual([
      'withdrawn',
      null,
    ])
  })

  test('takes a listing off sale until it is approved again, keeping its web address', async () => {
    const product = await waiting()
    const approved = (await approve(product.id)).product

    const drafted = await toDraft(product.id)
    expect(drafted).toMatchObject({
      status: 'draft',
      publishedAt: approved.publishedAt,
    })
    expect(await visibleToVisitors(product.id)).toBe(false)

    const changed = await as(seller, (tx) =>
      updateProduct(tx, photos, seller, product.id, { title: 'New title' }),
    )
    expect(changed.slug).toBe(approved.slug)
    await submit(product.id)
    await screen(product.id)
    await approve(product.id)
    expect(await visibleToVisitors(product.id)).toBe(true)
  })

  test('brings an archived listing back to change and resubmit', async () => {
    const product = await waiting()
    await approve(product.id)
    await archive(product.id)
    expect(await toDraft(product.id)).toMatchObject({ status: 'draft' })
  })

  test('not for a listing that can already change, and only by its seller', async () => {
    const product = await draft()
    await expect(toDraft(product.id)).rejects.toThrow(
      new ConflictError('This listing can already be changed'),
    )
    await submit(product.id)
    await reject(product.id, { reason: 'Blurry photo' })
    await expect(toDraft(product.id)).rejects.toThrow(
      new ConflictError('This listing can already be changed'),
    )
    await expect(toDraft(product.id, await newSeller())).rejects.toThrow(
      NotFoundError,
    )
    await expect(toDraft(product.id, admin)).rejects.toThrow(ForbiddenError)
  })

  test('a withdrawal and an approval at the same moment end consistently', async () => {
    const product = await waiting()
    const { pid, release, finished } = await holdRows(
      owner,
      products,
      products.id,
      [product.id],
    )
    const attempts = [
      outcomeOf(approve(product.id), 'done'),
      outcomeOf(toDraft(product.id), 'done'),
    ]
    await waitUntil(async () => (await sessionsWaitingOn(owner, pid)) >= 2)
    release()
    await finished
    await Promise.all(attempts)

    // Whichever went first, the listing ends as a draft with its one review
    // closed: approved and then moved back, or withdrawn before a decision.
    expect((await productRow(product.id)).status).toBe('draft')
    const reviews = await reviewsOf(product.id)
    expect(reviews).toHaveLength(1)
    expect(['approved', 'withdrawn']).toContain(reviews[0]!.decision)
  })
})

describe('takeDownProduct', () => {
  test('takes a listing off sale with a reason the seller sees, and audits it', async () => {
    const product = await waiting()
    await approve(product.id)

    const { product: taken } = await takeDown(product.id, {
      reason: 'A buyer reported that the bristles are nylon',
    })
    expect(taken).toMatchObject({
      status: 'rejected',
      rejectionReason: 'A buyer reported that the bristles are nylon',
    })
    expect(await visibleToVisitors(product.id)).toBe(false)
    expect((await auditOf('product', product.id)).at(-1)).toEqual({
      action: 'product.take_down',
      actorUserId: admin.userId,
      actorRole: 'admin',
      before: { status: 'approved' },
      after: {
        status: 'rejected',
        reason: 'A buyer reported that the bristles are nylon',
      },
      ip: IP,
    })

    // The seller changes it and submits it again, like any rejected listing.
    await as(seller, (tx) =>
      updateProduct(tx, photos, seller, product.id, {
        description: 'Charcoal-infused bristles made from castor oil.',
      }),
    )
    await expect(submit(product.id)).resolves.toMatchObject({
      status: 'pending_review',
      rejectionReason: null,
    })
  })

  test('only a listing on sale, with a reason, by an administrator', async () => {
    const product = await waiting()
    await expect(
      takeDown(product.id, { reason: 'Not on sale yet' }),
    ).rejects.toThrow(
      new ConflictError('Only a listing that is on sale can be taken down'),
    )
    await approve(product.id)
    expect(await validationIssues(takeDown(product.id, {}))).toEqual([
      'reason is required',
    ])
    await expect(takeDown(product.id, { reason: 'x' }, seller)).rejects.toThrow(
      ForbiddenError,
    )
    await expect(takeDown(randomUUID(), { reason: 'x' })).rejects.toThrow(
      NotFoundError,
    )
  })
})

describe('listReviewQueue', () => {
  test('highest risk first, then oldest first, unscreened last, a page at a time', async () => {
    const ids = {
      unscreened: await reviewWith(null, -10),
      lowOld: await reviewWith('low', -5),
      high2: await reviewWith('high', 2),
      medium: await reviewWith('medium', -1),
      high1: await reviewWith('high', 1),
    }
    const all = await wholeQueue()
    const mine = all
      .map((item) => item.reviewId)
      .filter((id) => Object.values(ids).includes(id))
    expect(mine).toEqual([
      ids.high1,
      ids.high2,
      ids.medium,
      ids.lowOld,
      ids.unscreened,
    ])
    // The whole queue follows the same order, with no repeats.
    const rank = { high: 0, medium: 1, low: 2 }
    const keys = all.map((item) => [
      item.risk ? rank[item.risk] : 3,
      item.submittedAt.getTime(),
    ])
    expect(keys).toEqual(
      keys.toSorted(([ra, ta], [rb, tb]) => ra! - rb! || ta! - tb!),
    )
    expect(new Set(all.map((item) => item.reviewId)).size).toBe(all.length)
  })

  test('one risk level at a time', async () => {
    const high = await reviewWith('high', 0)
    const highs = await wholeQueue({ risk: 'high' })
    expect(highs.every((item) => item.risk === 'high')).toBe(true)
    expect(highs.map((item) => item.reviewId)).toContain(high)
    await expect(queuePage({ risk: 'urgent' })).rejects.toThrow(
      'risk must be one of high, medium, low',
    )
  })

  test('shows the product, its seller, and what screening found', async () => {
    const product = await waiting({ description: '' })
    const item = (await wholeQueue({ risk: 'medium' })).find(
      (entry) => entry.product.id === product.id,
    )
    expect(item).toMatchObject({
      risk: 'medium',
      flags: [
        { code: 'missing_description', detail: 'The description is empty' },
        { code: 'ai_not_checked', detail: 'AI checks are switched off' },
      ],
      product: {
        title: 'Bamboo Toothbrush, Pack of 4',
        categoryName: category.name,
        minPricePaise: 19_900,
        maxPricePaise: 19_900,
        publishedAt: null,
      },
      seller: { id: seller.sellerId, status: 'approved' },
    })
    expect(item!.seller.displayName).toMatch(/^Seller /)
    // Decided reviews leave the queue.
    await approve(product.id)
    expect(
      (await wholeQueue()).some((entry) => entry.product.id === product.id),
    ).toBe(false)
  })

  test('administrators only, with a cursor from this queue', async () => {
    await expect(queuePage({}, seller)).rejects.toThrow(
      new ForbiddenError('Only administrators can review listings'),
    )
    await expect(
      queuePage({
        cursor: encodeCursor('2026-10-11T00:00:00.000000Z', randomUUID()),
      }),
    ).rejects.toThrow('That page cursor is not valid')
  })
})

describe('getProductForReview', () => {
  test('shows at most the 20 latest reviews, newest first', async () => {
    const product = await draft()
    const decidedAt = new Date()
    await owner.insert(productModeration).values(
      Array.from({ length: 21 }, (_, index) => ({
        productId: product.id,
        decision: 'rejected',
        decidedAt,
        reason: `Attempt ${index}`,
        createdAt: new Date(Date.now() - (21 - index) * 60_000),
      })),
    )
    const { reviews } = await reviewFor(product.id)
    expect(reviews).toHaveLength(20)
    expect(reviews[0]!.reason).toBe('Attempt 20')
    expect(reviews.at(-1)!.reason).toBe('Attempt 1')
  })

  test('administrators only; unknown and deleted products are not found', async () => {
    const product = await draft()
    await expect(reviewFor(product.id, seller)).rejects.toThrow(ForbiddenError)
    await expect(reviewFor(randomUUID())).rejects.toThrow(NotFoundError)
    await expect(reviewFor('not-an-id')).rejects.toThrow(NotFoundError)
    await owner
      .update(products)
      .set({ deletedAt: new Date() })
      .where(eq(products.id, product.id))
    await expect(reviewFor(product.id)).rejects.toThrow(NotFoundError)
  })
})

describe('a category’s rate change', () => {
  test('reaches its approved products, except a rate an administrator chose', async () => {
    const own = await createTestCategory(owner)
    const following = await waiting({ categoryId: own.id })
    await approve(following.id)
    const overridden = await waiting({ categoryId: own.id })
    await approve(overridden.id, { gstRateBps: 500 })
    const pending = await waiting({ categoryId: own.id })

    await as(admin, (tx) =>
      updateCategory(tx, admin, own.id, { gstRateBps: 4000 }, IP),
    )
    const rates = await owner
      .select({ id: products.id, rate: products.gstRateBps })
      .from(products)
      .where(inArray(products.id, [following.id, overridden.id, pending.id]))
    expect(Object.fromEntries(rates.map((row) => [row.id, row.rate]))).toEqual({
      [following.id]: 4000,
      [overridden.id]: 500,
      [pending.id]: null,
    })
    expect(
      (await auditOf('category', own.id)).filter(
        (entry) => entry.action === 'category.update_product_rates',
      ),
    ).toEqual([
      {
        action: 'category.update_product_rates',
        actorUserId: admin.userId,
        actorRole: 'admin',
        before: { gstRateBps: 1800 },
        after: { gstRateBps: 4000, products: 1 },
        ip: IP,
      },
    ])
  })

  test('a change that reaches no approved product writes no extra entry', async () => {
    const own = await createTestCategory(owner)
    await waiting({ categoryId: own.id })
    await as(admin, (tx) =>
      updateCategory(tx, admin, own.id, { gstRateBps: 500 }),
    )
    expect(
      (await auditOf('category', own.id)).map((entry) => entry.action),
    ).toEqual(['category.update'])
  })
})
