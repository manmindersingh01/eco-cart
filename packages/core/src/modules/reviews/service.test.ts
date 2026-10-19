import { eq, gt, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import {
  auditLogs,
  cacheInvalidations,
  products,
  reviews,
} from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../errors.ts'
import {
  createTestCategory,
  createTestOrderWithLines,
  createTestProduct,
  createTestSeller,
  createTestUser,
} from '../../testing/fixtures.ts'
import {
  getOwnReview,
  listProductReviews,
  listReviews,
  setReviewStatus,
  updateOwnReview,
  writeReview,
} from './service.ts'

/*
 * Product reviews (backend spec step 16), as the web app runs them: buyers,
 * visitors, and administrators through ecokart_web with row-level security.
 */

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'reviews-test')
  pools.push(pool)
  return createDatabase(pool)
}
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))
const web = connect(requireEnv('DATABASE_URL'))

type Buyer = Extract<RequestContext, { role: 'buyer' }>
let admin: Extract<RequestContext, { role: 'admin' }>
let sellerContext: RequestContext
let sellerId: string
let categoryId: string

beforeAll(async () => {
  admin = { role: 'admin', userId: (await createTestUser(owner, 'admin')).id }
  const { owner: user, seller } = await createTestSeller(owner)
  sellerId = seller.id
  sellerContext = { role: 'seller', userId: user.id, sellerId: seller.id }
  categoryId = (await createTestCategory(owner)).id
})

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()))
})

const newBuyer = async (): Promise<Buyer> => ({
  role: 'buyer',
  userId: (await createTestUser(owner, 'buyer')).id,
})

const onSale = async (status?: 'draft' | 'archived') =>
  (
    await createTestProduct(owner, {
      sellerId,
      categoryId,
      ...(status ? { status } : {}),
    })
  ).product

const review = (context: RequestContext, slug: string, input: unknown) =>
  withContext(web, context, (tx) => writeReview(tx, context, slug, input))

const rating = async (productId: string) => {
  const [row] = await owner
    .select({ avg: products.ratingAvg, count: products.ratingCount })
    .from(products)
    .where(eq(products.id, productId))
  return row!
}

const issuesOf = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('expected a ValidationError')
    },
    (error: unknown) => {
      if (!(error instanceof ValidationError)) throw error
      return error.issues
    },
  )

describe('writing a review', () => {
  test('is a verified purchase from a buyer who received the product', async () => {
    const { product, variant } = await createTestProduct(owner, {
      sellerId,
      categoryId,
    })
    const buyer = await newBuyer()
    const { items } = await createTestOrderWithLines(owner, {
      buyerId: buyer.userId,
      status: 'completed',
      lines: [
        {
          sellerId,
          productId: product.id,
          variantId: variant.id,
          status: 'delivered',
        },
      ],
    })
    const written = await review(buyer, product.slug, {
      rating: 4,
      authorName: 'Meera',
    })
    expect(written).toMatchObject({ verifiedPurchase: true })
    const [row] = await owner
      .select({ orderItemId: reviews.orderItemId })
      .from(reviews)
      .where(eq(reviews.id, written.id))
    expect(row?.orderItemId).toBe(items[0]!.id)
  })

  test('a buyer reviews a product on sale once, and its rating follows', async () => {
    const product = await onSale()
    const [first, second] = [await newBuyer(), await newBuyer()]
    const [mark] = await owner
      .select({ id: sql<number>`coalesce(max(id), 0)::int` })
      .from(cacheInvalidations)

    const written = await review(first, product.slug, {
      rating: 5,
      authorName: '  Priya S. ',
      title: 'Lasts for months',
      body: '',
    })
    expect(written).toMatchObject({
      rating: 5,
      authorName: 'Priya S.',
      title: 'Lasts for months',
      body: null,
      status: 'published',
      // Neither buyer has received the product.
      verifiedPurchase: false,
    })
    expect(await rating(product.id)).toEqual({ avg: '5.00', count: 1 })

    await review(second, product.slug, { rating: 2, authorName: 'Arjun' })
    expect(await rating(product.id)).toEqual({ avg: '3.50', count: 2 })

    await expect(
      review(first, product.slug, { rating: 1, authorName: 'Priya S.' }),
    ).rejects.toThrow(
      new ConflictError(
        'You have already reviewed this product; change your review instead',
      ),
    )
    expect(await rating(product.id)).toEqual({ avg: '3.50', count: 2 })

    // The product's storefront pages show the rating.
    const tags = await owner
      .select({ tag: cacheInvalidations.tag })
      .from(cacheInvalidations)
      .where(gt(cacheInvalidations.id, mark!.id))
    expect(tags.map((row) => row.tag)).toEqual(
      expect.arrayContaining([
        `product:${product.id}`,
        `product-slug:${product.slug}`,
        'home',
      ]),
    )
  })

  test('only buyers write reviews', async () => {
    const product = await onSale()
    for (const context of [
      { role: 'anonymous' } as const,
      sellerContext,
      admin,
    ]) {
      await expect(
        review(context, product.slug, { rating: 4, authorName: 'Someone' }),
      ).rejects.toThrow(ForbiddenError)
    }
  })

  test('a product that is not on sale cannot be reviewed', async () => {
    const buyer = await newBuyer()
    for (const slug of [
      (await onSale('draft')).slug,
      (await onSale('archived')).slug,
      'no-such-product',
      'Not A Slug!',
    ]) {
      await expect(
        review(buyer, slug, { rating: 4, authorName: 'Meera' }),
      ).rejects.toThrow(
        new NotFoundError('There is no product at that address'),
      )
    }
  })

  test('refuses details it cannot use, saying what is wrong', async () => {
    const product = await onSale()
    const buyer = await newBuyer()
    expect(
      await issuesOf(
        review(buyer, product.slug, {
          rating: 6,
          authorName: '',
          title: 'x'.repeat(101),
          photo: 'a.jpg',
        }),
      ),
    ).toEqual([
      'rating must be at most 5',
      'authorName must not be empty',
      'title must be at most 100 characters',
      'photo is not allowed here',
    ])
    expect(
      await issuesOf(review(buyer, product.slug, { rating: 3.5 })),
    ).toEqual(['rating must be a whole number', 'authorName is required'])
  })
})

describe('changing a review', () => {
  test('the buyer changes their own review, and the rating follows', async () => {
    const product = await onSale()
    const buyer = await newBuyer()
    await review(buyer, product.slug, {
      rating: 2,
      authorName: 'Kabir',
      title: 'Too small',
    })
    const changed = await withContext(web, buyer, (tx) =>
      updateOwnReview(tx, buyer, product.slug, { rating: 4, title: '' }),
    )
    expect(changed).toMatchObject({
      rating: 4,
      title: null,
      authorName: 'Kabir',
    })
    expect(await rating(product.id)).toEqual({ avg: '4.00', count: 1 })

    // Nothing to change answers the review as it is.
    const same = await withContext(web, buyer, (tx) =>
      updateOwnReview(tx, buyer, product.slug, {}),
    )
    expect(same.rating).toBe(4)
  })

  test('a buyer without a review gets 404, and never changes anyone else’s', async () => {
    const product = await onSale()
    const [writer, other] = [await newBuyer(), await newBuyer()]
    await review(writer, product.slug, { rating: 5, authorName: 'Ananya' })
    await expect(
      withContext(web, other, (tx) =>
        updateOwnReview(tx, other, product.slug, { rating: 1 }),
      ),
    ).rejects.toThrow(
      new NotFoundError('You have not reviewed this product yet'),
    )
    await expect(
      withContext(web, other, (tx) => getOwnReview(tx, other, product.slug)),
    ).rejects.toThrow(NotFoundError)

    // Row-level security stops a direct attempt too.
    const changed = await withContext(web, other, (tx) =>
      tx
        .update(reviews)
        .set({ rating: 1 })
        .where(eq(reviews.productId, product.id))
        .returning(),
    )
    expect(changed).toEqual([])
    expect(await rating(product.id)).toEqual({ avg: '5.00', count: 1 })
  })

  test('a buyer cannot change a product’s rating except through a review', async () => {
    const product = await onSale()
    const buyer = await newBuyer()
    const changed = await withContext(web, buyer, (tx) =>
      tx
        .update(products)
        .set({ ratingAvg: '5.00', ratingCount: 1000 })
        .where(eq(products.id, product.id))
        .returning({ id: products.id }),
    )
    expect(changed).toEqual([])
    // The database function only ever recalculates from the reviews.
    await withContext(web, buyer, (tx) =>
      tx.execute(sql`select app.refresh_product_rating(${product.id}::uuid)`),
    )
    expect(await rating(product.id)).toEqual({ avg: '0.00', count: 0 })
  })
})

describe('reviews written at the same moment', () => {
  test('are all counted', async () => {
    const product = await onSale()
    const buyers = await Promise.all(
      Array.from({ length: 8 }, () => newBuyer()),
    )
    await Promise.all(
      buyers.map((buyer, index) =>
        review(buyer, product.slug, {
          rating: (index % 5) + 1,
          authorName: `Buyer ${index}`,
        }),
      ),
    )
    // Ratings 1, 2, 3, 4, 5, 1, 2, 3: 21 / 8.
    expect(await rating(product.id)).toEqual({ avg: '2.63', count: 8 })
  })
})

describe('hiding a review', () => {
  test('takes it out of the rating and the list, with an audit entry, until it is shown again', async () => {
    const product = await onSale()
    const [kind, rude] = [await newBuyer(), await newBuyer()]
    await review(kind, product.slug, { rating: 5, authorName: 'Nisha' })
    const hidden = await review(rude, product.slug, {
      rating: 1,
      authorName: 'Anon',
      body: 'Something rude',
    })
    expect(await rating(product.id)).toEqual({ avg: '3.00', count: 2 })

    const decided = await withContext(web, admin, (tx) =>
      setReviewStatus(
        tx,
        admin,
        hidden.id,
        { status: 'hidden' },
        '203.0.113.9',
      ),
    )
    expect(decided).toMatchObject({
      status: 'hidden',
      userId: rude.userId,
      product: { id: product.id, slug: product.slug, title: product.title },
    })
    expect(await rating(product.id)).toEqual({ avg: '5.00', count: 1 })
    const visible = await withContext(web, { role: 'anonymous' }, (tx) =>
      listProductReviews(tx, product.slug, {}),
    )
    expect(visible.items.map((item) => item.authorName)).toEqual(['Nisha'])

    // The buyer still sees it, hidden, and changing it keeps it hidden.
    const own = await withContext(web, rude, (tx) =>
      updateOwnReview(tx, rude, product.slug, { body: 'Sorry' }),
    )
    expect(own.status).toBe('hidden')
    expect(await rating(product.id)).toEqual({ avg: '5.00', count: 1 })

    // Deciding the same again changes nothing and writes no audit entry.
    await withContext(web, admin, (tx) =>
      setReviewStatus(tx, admin, hidden.id, { status: 'hidden' }),
    )
    await withContext(web, admin, (tx) =>
      setReviewStatus(tx, admin, hidden.id, { status: 'published' }),
    )
    expect(await rating(product.id)).toEqual({ avg: '3.00', count: 2 })
    const entries = await owner
      .select({
        action: auditLogs.action,
        actor: auditLogs.actorUserId,
        before: auditLogs.before,
        after: auditLogs.after,
        ip: auditLogs.ip,
      })
      .from(auditLogs)
      .where(eq(auditLogs.entityId, hidden.id))
      .orderBy(auditLogs.id)
    expect(entries).toEqual([
      {
        action: 'review.hide',
        actor: admin.userId,
        before: { status: 'published' },
        after: { status: 'hidden' },
        ip: '203.0.113.9',
      },
      {
        action: 'review.publish',
        actor: admin.userId,
        before: { status: 'hidden' },
        after: { status: 'published' },
        ip: null,
      },
    ])
  })

  test('only administrators decide, and an unknown review or decision is refused', async () => {
    const product = await onSale()
    const buyer = await newBuyer()
    const written = await review(buyer, product.slug, {
      rating: 3,
      authorName: 'Ravi',
    })
    await expect(
      withContext(web, buyer, (tx) =>
        setReviewStatus(tx, buyer, written.id, { status: 'hidden' }),
      ),
    ).rejects.toThrow(ForbiddenError)
    await expect(
      withContext(web, admin, (tx) =>
        setReviewStatus(tx, admin, crypto.randomUUID(), { status: 'hidden' }),
      ),
    ).rejects.toThrow(new NotFoundError('There is no review with that id'))
    expect(
      await issuesOf(
        withContext(web, admin, (tx) =>
          setReviewStatus(tx, admin, written.id, { status: 'deleted' }),
        ),
      ),
    ).toEqual(['status must be published or hidden'])
  })

  test('another buyer never sees a hidden review', async () => {
    const product = await onSale()
    const [writer, other] = [await newBuyer(), await newBuyer()]
    const written = await review(writer, product.slug, {
      rating: 1,
      authorName: 'Dev',
    })
    await withContext(web, admin, (tx) =>
      setReviewStatus(tx, admin, written.id, { status: 'hidden' }),
    )
    const seen = await withContext(web, other, (tx) =>
      tx.select().from(reviews).where(eq(reviews.id, written.id)),
    )
    expect(seen).toEqual([])
  })
})

describe('listing reviews', () => {
  test('visitors page through the published reviews, newest first, without repeats', async () => {
    const product = await onSale()
    const buyers = await Promise.all(
      Array.from({ length: 5 }, () => newBuyer()),
    )
    for (const [index, buyer] of buyers.entries()) {
      await review(buyer, product.slug, {
        rating: 4,
        authorName: `Reviewer ${index}`,
      })
    }
    const read = (query: Record<string, string>) =>
      withContext(web, { role: 'anonymous' }, (tx) =>
        listProductReviews(tx, product.slug, query),
      )
    const first = await read({ limit: '2' })
    const second = await read({ limit: '2', cursor: first.nextCursor! })
    const third = await read({ limit: '2', cursor: second.nextCursor! })
    expect(
      [...first.items, ...second.items, ...third.items].map(
        (item) => item.authorName,
      ),
    ).toEqual([
      'Reviewer 4',
      'Reviewer 3',
      'Reviewer 2',
      'Reviewer 1',
      'Reviewer 0',
    ])
    expect(third.nextCursor).toBeNull()
    expect(await issuesOf(read({ limit: 'many' }))).toEqual([
      'limit must be a whole number',
    ])
    await expect(
      withContext(web, { role: 'anonymous' }, (tx) =>
        listProductReviews(tx, 'no-such-product', {}),
      ),
    ).rejects.toThrow(NotFoundError)
  })

  test('administrators list reviews by status with their product', async () => {
    const product = await onSale()
    const buyer = await newBuyer()
    const written = await review(buyer, product.slug, {
      rating: 2,
      authorName: 'Isha',
    })
    await withContext(web, admin, (tx) =>
      setReviewStatus(tx, admin, written.id, { status: 'hidden' }),
    )
    const hidden = await withContext(web, admin, (tx) =>
      listReviews(tx, admin, { status: 'hidden', limit: 100 }),
    )
    expect(hidden.items.find((item) => item.id === written.id)).toMatchObject({
      status: 'hidden',
      product: { id: product.id },
    })
    expect(hidden.items.every((item) => item.status === 'hidden')).toBe(true)
    await expect(
      withContext(web, admin, (tx) =>
        listReviews(tx, admin, { status: 'deleted' }),
      ),
    ).rejects.toThrow(new ValidationError('status must be published or hidden'))
    await expect(
      withContext(web, buyer, (tx) => listReviews(tx, buyer)),
    ).rejects.toThrow(ForbiddenError)
  })
})
