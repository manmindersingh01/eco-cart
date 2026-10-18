import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Transaction } from '../../db/client.ts'
import type { RequestContext } from '../../db/context.ts'
import { reviews } from '../../db/schema/index.ts'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../errors.ts'
import {
  afterCursor,
  exactTime,
  newestFirstCursor,
  pageSize,
  toPage,
  type Page,
} from '../../lib/pagination.ts'
import { uniqueViolation } from '../../lib/postgres.ts'
import { isUuid, parseInput, strictObject } from '../../lib/validation.ts'
import { recordAuditEntry } from '../audit/service.ts'
import { invalidateStorefront } from '../catalogue/storefront-cache.ts'
import {
  findProductOnSale,
  getProductLabels,
  type ProductLabel,
} from '../catalogue/storefront.ts'
import {
  newReview,
  REVIEW_STATUSES,
  reviewDecision,
  reviewUpdate,
  type AdminReview,
  type AdminReviewOptions,
  type OwnReview,
  type PublicReview,
  type ReviewStatus,
} from './types.ts'

/*
 * Product reviews (backend spec step 16, design doc 5.10). Any signed-in
 * buyer may review a product on sale once and change the review later;
 * administrators can hide a review and show it again. Every change
 * recalculates the product's rating in the same transaction and refreshes
 * its storefront pages.
 *
 * Locks are taken in one order: the review row (by the INSERT or UPDATE),
 * then the product row (inside app.refresh_product_rating). Checkout never
 * touches reviews, so the two cannot wait for each other.
 */

type ReviewRow = typeof reviews.$inferSelect
type Buyer = Extract<RequestContext, { role: 'buyer' }>
type Administrator = Extract<RequestContext, { role: 'admin' | 'system' }>

const INVALID = 'Those review details are not valid'
const NO_PRODUCT = 'There is no product at that address'
const NO_OWN_REVIEW = 'You have not reviewed this product yet'
const NO_REVIEW = 'There is no review with that id'

function assertBuyer(context: RequestContext): asserts context is Buyer {
  if (context.role !== 'buyer') {
    throw new ForbiddenError('Only buyers can review products')
  }
}

function assertAdministrator(
  context: RequestContext,
): asserts context is Administrator {
  if (context.role !== 'admin' && context.role !== 'system') {
    throw new ForbiddenError('Only administrators can moderate reviews')
  }
}

const isStatus = (value: string): value is ReviewStatus =>
  REVIEW_STATUSES.some((status) => status === value)

function statusOf(row: ReviewRow): ReviewStatus {
  if (!isStatus(row.status)) {
    throw new Error(`Review ${row.id} has an unknown status ${row.status}`)
  }
  return row.status
}

const toPublic = (row: ReviewRow): PublicReview => ({
  id: row.id,
  rating: row.rating,
  authorName: row.authorName,
  title: row.title,
  body: row.body,
  verifiedPurchase: row.orderItemId !== null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const toOwn = (row: ReviewRow): OwnReview => ({
  ...toPublic(row),
  status: statusOf(row),
})

const toAdmin = (
  row: ReviewRow,
  product: ProductLabel | undefined,
): AdminReview => ({
  ...toOwn(row),
  product: product ?? null,
  userId: row.userId,
})

async function productAt(
  tx: Transaction,
  productSlug: string,
): Promise<ProductLabel> {
  const product = await findProductOnSale(tx, productSlug)
  if (!product) throw new NotFoundError(NO_PRODUCT)
  return product
}

/**
 * Recalculates the product's rating from its published reviews, through the
 * database function that may change a product for a buyer (migration
 * 0024), and refreshes the product's storefront pages.
 */
async function refreshRating(
  tx: Transaction,
  productId: string,
): Promise<void> {
  await tx.execute(sql`select app.refresh_product_rating(${productId}::uuid)`)
  await invalidateStorefront(tx, { productIds: [productId] })
}

/** A buyer's first review of the product on sale at `productSlug`. */
export async function writeReview(
  tx: Transaction,
  context: RequestContext,
  productSlug: string,
  input: unknown,
): Promise<OwnReview> {
  assertBuyer(context)
  const review = parseInput(newReview, input, INVALID)
  const product = await productAt(tx, productSlug)
  let row: ReviewRow | undefined
  try {
    ;[row] = await tx
      .insert(reviews)
      .values({
        productId: product.id,
        userId: context.userId,
        ...review,
        // Step 13 (buyer lane) exports the lookup of the buyer's delivered
        // order line for a product; until it merges, no review is verified.
        orderItemId: null,
      })
      .returning()
  } catch (error) {
    if (uniqueViolation(error) === 'reviews_product_id_user_id_key') {
      throw new ConflictError(
        'You have already reviewed this product; change your review instead',
      )
    }
    throw error
  }
  if (!row) throw new Error(`The review of ${product.id} was not saved`)
  await refreshRating(tx, product.id)
  return toOwn(row)
}

/** The buyer's own review of the product at `productSlug`, or 404. */
export async function getOwnReview(
  tx: Transaction,
  context: RequestContext,
  productSlug: string,
): Promise<OwnReview> {
  assertBuyer(context)
  const product = await productAt(tx, productSlug)
  const [row] = await tx
    .select()
    .from(reviews)
    .where(
      and(
        eq(reviews.productId, product.id),
        eq(reviews.userId, context.userId),
      ),
    )
  if (!row) throw new NotFoundError(NO_OWN_REVIEW)
  return toOwn(row)
}

/**
 * Changes the buyer's own review. A review an administrator hid stays
 * hidden.
 */
export async function updateOwnReview(
  tx: Transaction,
  context: RequestContext,
  productSlug: string,
  input: unknown,
): Promise<OwnReview> {
  assertBuyer(context)
  const changes = parseInput(reviewUpdate, input, INVALID)
  if (Object.keys(changes).length === 0) {
    return getOwnReview(tx, context, productSlug)
  }
  const product = await productAt(tx, productSlug)
  const [row] = await tx
    .update(reviews)
    .set(changes)
    .where(
      and(
        eq(reviews.productId, product.id),
        eq(reviews.userId, context.userId),
      ),
    )
    .returning()
  if (!row) throw new NotFoundError(NO_OWN_REVIEW)
  await refreshRating(tx, product.id)
  return toOwn(row)
}

const reviewListing = strictObject({
  cursor: z.string().max(200).optional(),
  limit: z
    .string()
    .regex(/^\d{1,3}$/, 'must be a whole number')
    .transform(Number)
    .optional(),
})

/**
 * The published reviews of the product on sale at `productSlug`, newest
 * first. `query` is the request's query string: `cursor` and `limit`.
 */
export async function listProductReviews(
  tx: Transaction,
  productSlug: string,
  query: Record<string, string>,
): Promise<Page<PublicReview>> {
  const options = parseInput(
    reviewListing,
    query,
    'Those review list details are not valid',
  )
  const product = await productAt(tx, productSlug)
  const limit = pageSize(options.limit)
  const rows = await tx
    .select({ review: reviews, cursorTime: exactTime(reviews.createdAt) })
    .from(reviews)
    .where(
      and(
        eq(reviews.productId, product.id),
        eq(reviews.status, 'published'),
        options.cursor
          ? afterCursor(options.cursor, reviews.createdAt, reviews.id)
          : undefined,
      ),
    )
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .limit(limit + 1)
  return toPage(
    rows,
    limit,
    (row) => toPublic(row.review),
    (row) =>
      newestFirstCursor({ cursorTime: row.cursorTime, id: row.review.id }),
  )
}

/** Reviews of one status, newest first. Administrators only. */
export async function listReviews(
  tx: Transaction,
  context: RequestContext,
  options: AdminReviewOptions = {},
): Promise<Page<AdminReview>> {
  assertAdministrator(context)
  const status = options.status ?? 'published'
  if (!isStatus(status)) {
    throw new ValidationError('status must be published or hidden')
  }
  const limit = pageSize(options.limit)
  const rows = await tx
    .select({ review: reviews, cursorTime: exactTime(reviews.createdAt) })
    .from(reviews)
    .where(
      and(
        eq(reviews.status, status),
        options.cursor
          ? afterCursor(options.cursor, reviews.createdAt, reviews.id)
          : undefined,
      ),
    )
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .limit(limit + 1)
  const products = await getProductLabels(
    tx,
    rows.map((row) => row.review.productId),
  )
  return toPage(
    rows,
    limit,
    (row) => toAdmin(row.review, products.get(row.review.productId)),
    (row) =>
      newestFirstCursor({ cursorTime: row.cursorTime, id: row.review.id }),
  )
}

/**
 * Hides a review or shows it again, with an audit entry. The product's
 * rating counts published reviews only. Administrators only.
 */
export async function setReviewStatus(
  tx: Transaction,
  context: RequestContext,
  reviewId: string,
  input: unknown,
  ip?: string | null,
): Promise<AdminReview> {
  assertAdministrator(context)
  const { status } = parseInput(
    reviewDecision,
    input,
    'That review decision is not valid',
  )
  if (!isUuid(reviewId)) throw new NotFoundError(NO_REVIEW)
  const [current] = await tx
    .select()
    .from(reviews)
    .where(eq(reviews.id, reviewId))
    .for('update')
  if (!current) throw new NotFoundError(NO_REVIEW)

  let row = current
  if (current.status !== status) {
    const [updated] = await tx
      .update(reviews)
      .set({ status })
      .where(eq(reviews.id, reviewId))
      .returning()
    if (!updated) throw new Error(`Review ${reviewId} could not be updated`)
    row = updated
    await refreshRating(tx, current.productId)
    await recordAuditEntry(tx, {
      actorUserId: context.userId ?? null,
      actorRole: context.role,
      action: status === 'hidden' ? 'review.hide' : 'review.publish',
      entityType: 'review',
      entityId: reviewId,
      before: { status: current.status },
      after: { status },
      ip,
    })
  }
  const products = await getProductLabels(tx, [row.productId])
  return toAdmin(row, products.get(row.productId))
}
