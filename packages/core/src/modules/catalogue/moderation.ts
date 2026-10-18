import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm'
import type { Transaction } from '../../db/client.ts'
import type { RequestContext } from '../../db/context.ts'
import {
  categories,
  productImages,
  productModeration,
  productVariants,
  productVideos,
  products,
} from '../../db/schema/index.ts'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../errors.ts'
import { imageSizeKey } from '../../lib/images.ts'
import {
  afterRankedCursor,
  exactTime,
  pageSize,
  rankedCursor,
  toPage,
  type Page,
} from '../../lib/pagination.ts'
import { uniqueViolation } from '../../lib/postgres.ts'
import type { JobQueue } from '../../lib/queue.ts'
import { isUuid, parseInput } from '../../lib/validation.ts'
import { recordAuditEntry, type AuditEntry } from '../audit/service.ts'
import { getSellerLabels, type SellerLabel } from '../sellers/service.ts'
import { loadCategoryTree } from './categories.ts'
import {
  assertSeller,
  brandIssue,
  categoryIssue,
  lockOwnProduct,
  readProductView,
  throwIfAny,
  type PhotoAddresses,
} from './products.ts'
import { SCREEN_LISTING_QUEUE } from './screening.ts'
import { invalidateStorefront } from './storefront-cache.ts'
import { refreshProducts } from './summary.ts'
import {
  approval,
  rejection,
  RISK_LEVELS,
  type ProductForReview,
  type ProductStatus,
  type ProductView,
  type ReviewQueueItem,
  type ReviewQueueOptions,
  type ReviewView,
  type RiskLevel,
} from './types.ts'

/*
 * Listing moderation (backend spec step 7, design doc 6.2): a seller submits
 * a listing, the worker screens it (screening.ts), and an administrator
 * approves or rejects it. Every submission opens its own review row, so the
 * history of decisions is kept.
 *
 * Like every change to a product, these lock the product's row first. An
 * approval also reads its category's GST rate, so it locks the category row
 * before the product, the same order a category change takes.
 */

type ProductRow = typeof products.$inferSelect
type ReviewRow = typeof productModeration.$inferSelect
type Administrator = Extract<RequestContext, { role: 'admin' | 'system' }>

const NOT_FOUND = 'There is no product with that id'
const NOT_WAITING = 'This listing is not waiting for review'
const SUBMITTABLE: readonly ProductStatus[] = ['draft', 'rejected']
/** Reviews shown with a product: plenty for any real history. */
const REVIEW_HISTORY = 20

/** The queue's order of risk levels; a review not screened yet comes last. */
const RISK_RANK: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 }

const isRiskLevel = (value: string): value is RiskLevel =>
  RISK_LEVELS.some((level) => level === value)

function assertAdministrator(
  context: RequestContext,
): asserts context is Administrator {
  if (context.role !== 'admin' && context.role !== 'system') {
    throw new ForbiddenError('Only administrators can review listings')
  }
}

const administratorActor = (
  context: Administrator,
): Pick<AuditEntry, 'actorUserId' | 'actorRole'> => ({
  actorUserId: context.userId ?? null,
  actorRole: context.role,
})

function toRisk(value: string | null, reviewId: string): RiskLevel | null {
  if (value === null) return null
  if (!isRiskLevel(value)) {
    throw new Error(`Review ${reviewId} has an unknown risk ${value}`)
  }
  return value
}

function toReviewView(row: ReviewRow): ReviewView {
  const { decision } = row
  if (
    decision !== null &&
    decision !== 'approved' &&
    decision !== 'rejected' &&
    decision !== 'withdrawn'
  ) {
    throw new Error(`Review ${row.id} has an unknown decision ${decision}`)
  }
  return {
    id: row.id,
    submittedAt: row.submittedAt,
    risk: toRisk(row.aiRisk, row.id),
    flags: row.aiFlags,
    decision,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    reason: row.reason,
  }
}

/**
 * What stops a listing from being sold as it is, in words the seller can act
 * on. Submitting and approving both refuse a listing with any of these.
 */
async function readinessIssues(
  tx: Transaction,
  product: ProductRow,
): Promise<string[]> {
  // In the seller's order: the first is the main photo.
  const photos = await tx
    .select({ status: productImages.status })
    .from(productImages)
    .where(eq(productImages.productId, product.id))
    .orderBy(
      asc(productImages.sortOrder),
      asc(productImages.createdAt),
      asc(productImages.id),
    )
  const [video] = await tx
    .select({ status: productVideos.status })
    .from(productVideos)
    .where(eq(productVideos.productId, product.id))
  const [activeVariant] = await tx
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(
      and(
        eq(productVariants.productId, product.id),
        eq(productVariants.isActive, true),
      ),
    )
    .limit(1)
  const category = (await loadCategoryTree(tx)).byId(product.categoryId)
  const anyReady = photos.some((photo) => photo.status === 'ready')
  const issues = [
    anyReady
      ? null
      : 'Add at least one photo; the storefront needs a main image',
    anyReady && photos[0]?.status === 'failed'
      ? 'The main photo could not be used; remove it or put another photo first'
      : null,
    photos.some((photo) => photo.status === 'processing')
      ? 'Wait until every photo has been processed, which takes a few seconds'
      : null,
    video?.status === 'processing'
      ? 'Wait until the video has been processed, which takes up to a few minutes'
      : null,
    activeVariant
      ? null
      : 'Make at least one variant active; a listing needs a price',
    product.hsnCode || category?.defaultHsnCode
      ? null
      : 'hsnCode is required, because the category has no default HSN code',
    await categoryIssue(tx, product.categoryId),
    product.brandId ? await brandIssue(tx, product.brandId) : null,
  ]
  return issues.filter((issue) => issue !== null)
}

/**
 * Submits a draft or rejected listing for review: it moves to
 * pending_review, a review opens, and the screening job is queued, all in
 * this transaction. A listing that could not be sold as it is gets a 400
 * with everything to fix.
 */
export async function submitProduct(
  tx: Transaction,
  photos: PhotoAddresses,
  queue: JobQueue,
  context: RequestContext,
  productId: string,
): Promise<ProductView> {
  assertSeller(context)
  const product = await lockOwnProduct(tx, context, productId)
  if (product.status === 'pending_review') {
    throw new ConflictError('This listing is already waiting for review')
  }
  if (!SUBMITTABLE.some((status) => status === product.status)) {
    throw new ConflictError(
      'Only a draft or rejected listing can be submitted for review',
    )
  }
  throwIfAny(
    'This listing cannot be submitted for review yet',
    await readinessIssues(tx, product),
  )

  await tx
    .update(products)
    .set({ status: 'pending_review', rejectionReason: null })
    .where(eq(products.id, productId))
  const reviewId = randomUUID()
  try {
    await tx.insert(productModeration).values({ id: reviewId, productId })
  } catch (error) {
    // The product lock makes this unreachable; the index is the safety net.
    if (
      uniqueViolation(error) === 'product_moderation_open_product_id_unique'
    ) {
      throw new ConflictError('This listing is already waiting for review')
    }
    throw error
  }
  await queue.send(tx, SCREEN_LISTING_QUEUE, { reviewId })
  return readProductView(tx, photos, productId)
}

/**
 * Moves one of the seller's listings back to draft so it can change: one
 * waiting for review (its review is withdrawn), one on sale (it leaves the
 * storefront until it is approved again), or one archived. Price, MRP,
 * stock, and the active flag never need this; they change at any time.
 */
export async function moveToDraft(
  tx: Transaction,
  photos: PhotoAddresses,
  context: RequestContext,
  productId: string,
): Promise<ProductView> {
  assertSeller(context)
  const product = await lockOwnProduct(tx, context, productId)
  if (SUBMITTABLE.some((status) => status === product.status)) {
    throw new ConflictError('This listing can already be changed')
  }
  if (product.status === 'pending_review') {
    const withdrawn = await tx
      .update(productModeration)
      .set({
        decision: 'withdrawn',
        decidedBy: context.userId,
        decidedAt: sql`now()`,
      })
      .where(
        and(
          eq(productModeration.productId, productId),
          isNull(productModeration.decision),
        ),
      )
      .returning({ id: productModeration.id })
    if (withdrawn.length !== 1) {
      throw new Error(`Product ${productId} has no open review`)
    }
  }
  await tx
    .update(products)
    .set({ status: 'draft' })
    .where(eq(products.id, productId))
  if (product.status === 'approved') {
    await invalidateStorefront(tx, { productIds: [productId] })
  }
  return readProductView(tx, photos, productId)
}

/**
 * Takes one of the seller's approved listings off sale. It stays, archived,
 * for the orders that refer to it.
 */
export async function archiveProduct(
  tx: Transaction,
  photos: PhotoAddresses,
  context: RequestContext,
  productId: string,
): Promise<ProductView> {
  assertSeller(context)
  const product = await lockOwnProduct(tx, context, productId)
  if (product.status !== 'approved') {
    throw new ConflictError('Only a listing that is on sale can be archived')
  }
  await tx
    .update(products)
    .set({ status: 'archived' })
    .where(eq(products.id, productId))
  await invalidateStorefront(tx, { productIds: [productId] })
  return readProductView(tx, photos, productId)
}

/**
 * The open reviews, highest risk first and oldest first within a risk, with
 * reviews not screened yet last. Administrators only.
 */
export async function listReviewQueue(
  tx: Transaction,
  photos: PhotoAddresses,
  context: RequestContext,
  options: ReviewQueueOptions = {},
): Promise<Page<ReviewQueueItem>> {
  assertAdministrator(context)
  const { risk } = options
  if (risk !== undefined && !isRiskLevel(risk)) {
    throw new ValidationError(`risk must be one of ${RISK_LEVELS.join(', ')}`)
  }
  const limit = pageSize(options.limit)
  const conditions: SQL[] = [
    isNull(productModeration.decision),
    ...(risk ? [eq(productModeration.riskRank, RISK_RANK[risk])] : []),
    ...(options.cursor
      ? [
          afterRankedCursor(
            options.cursor,
            productModeration.riskRank,
            productModeration.submittedAt,
            productModeration.id,
          ),
        ]
      : []),
  ]
  const rows = await tx
    .select({
      id: productModeration.id,
      submittedAt: productModeration.submittedAt,
      aiRisk: productModeration.aiRisk,
      aiFlags: productModeration.aiFlags,
      rank: productModeration.riskRank,
      cursorTime: exactTime(productModeration.submittedAt),
      productId: products.id,
      sellerId: products.sellerId,
      slug: products.slug,
      title: products.title,
      categoryName: categories.name,
      minPricePaise: products.minPricePaise,
      maxPricePaise: products.maxPricePaise,
      publishedAt: products.publishedAt,
      thumbnailKey: productImages.storageKey,
    })
    .from(productModeration)
    .innerJoin(products, eq(products.id, productModeration.productId))
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(productImages, eq(productImages.id, products.primaryImageId))
    .where(and(...conditions))
    .orderBy(
      asc(productModeration.riskRank),
      asc(productModeration.submittedAt),
      asc(productModeration.id),
    )
    .limit(limit + 1)
  const sellers = await getSellerLabels(
    tx,
    rows.map((row) => row.sellerId),
  )
  return toPage(
    rows,
    limit,
    (row) => ({
      reviewId: row.id,
      submittedAt: row.submittedAt,
      risk: toRisk(row.aiRisk, row.id),
      flags: row.aiFlags,
      product: {
        id: row.productId,
        slug: row.slug,
        title: row.title,
        categoryName: row.categoryName,
        minPricePaise: row.minPricePaise,
        maxPricePaise: row.maxPricePaise,
        thumbnailUrl: row.thumbnailKey
          ? photos.publicUrl(imageSizeKey(row.thumbnailKey, 'thumb'))
          : null,
        publishedAt: row.publishedAt,
      },
      seller: sellerOf(sellers, row.sellerId),
    }),
    rankedCursor,
  )
}

function sellerOf(
  sellers: Map<string, SellerLabel>,
  sellerId: string,
): SellerLabel {
  const seller = sellers.get(sellerId)
  if (!seller) throw new Error(`Seller ${sellerId} does not exist`)
  return seller
}

/** One product with its seller and recent reviews. Administrators only. */
export async function getProductForReview(
  tx: Transaction,
  photos: PhotoAddresses,
  context: RequestContext,
  productId: string,
): Promise<ProductForReview> {
  assertAdministrator(context)
  if (!isUuid(productId)) throw new NotFoundError(NOT_FOUND)
  const [row] = await tx
    .select({ sellerId: products.sellerId })
    .from(products)
    .where(and(eq(products.id, productId), isNull(products.deletedAt)))
  if (!row) throw new NotFoundError(NOT_FOUND)
  const reviews = await tx
    .select()
    .from(productModeration)
    .where(eq(productModeration.productId, productId))
    .orderBy(desc(productModeration.createdAt), desc(productModeration.id))
    .limit(REVIEW_HISTORY)
  return {
    product: await readProductView(tx, photos, productId),
    seller: sellerOf(await getSellerLabels(tx, [row.sellerId]), row.sellerId),
    reviews: reviews.map(toReviewView),
  }
}

/**
 * Locks a product that is waiting for review, and its open review.
 * `lockCategory` first locks the product's category row, for an approval
 * that reads the category's rate.
 */
async function lockForDecision(
  tx: Transaction,
  productId: string,
  { lockCategory }: { lockCategory: boolean },
): Promise<{ product: ProductRow; review: ReviewRow }> {
  if (!isUuid(productId)) throw new NotFoundError(NOT_FOUND)
  if (lockCategory) {
    // The category before the product, like a category change, so the
    // two wait for each other instead of deadlocking, and the approval reads
    // the rate that is current when it commits.
    await tx
      .select({ id: categories.id })
      .from(categories)
      .innerJoin(products, eq(products.categoryId, categories.id))
      .where(eq(products.id, productId))
      .for('share', { of: categories })
  }
  const [product] = await tx
    .select()
    .from(products)
    .where(and(eq(products.id, productId), isNull(products.deletedAt)))
    .for('update')
  if (!product) throw new NotFoundError(NOT_FOUND)
  if (product.status !== 'pending_review') throw new ConflictError(NOT_WAITING)
  const [review] = await tx
    .select()
    .from(productModeration)
    .where(
      and(
        eq(productModeration.productId, productId),
        isNull(productModeration.decision),
      ),
    )
    .for('update')
  if (!review) throw new Error(`Product ${productId} has no open review`)
  return { product, review }
}

/**
 * Approves a listing whose screening has finished: copies the category's GST
 * rate (or the administrator's) and the HSN code onto the product and puts
 * it on sale. Administrators only.
 */
export async function approveProduct(
  tx: Transaction,
  photos: PhotoAddresses,
  context: RequestContext,
  productId: string,
  input: unknown,
  ip?: string | null,
): Promise<ProductForReview> {
  assertAdministrator(context)
  const { gstRateBps } = parseInput(
    approval,
    input,
    'That approval is not valid',
  )
  const { product, review } = await lockForDecision(tx, productId, {
    lockCategory: true,
  })
  if (review.aiRisk === null) {
    throw new ConflictError(
      'Screening has not finished yet; try again in a moment',
    )
  }
  throwIfAny(
    'This listing cannot be approved',
    await readinessIssues(tx, product),
  )
  const category = (await loadCategoryTree(tx)).byId(product.categoryId)
  const hsnCode = product.hsnCode ?? category?.defaultHsnCode
  if (!category || !hsnCode) {
    throw new Error(
      `Product ${productId} passed the checks without an HSN code`,
    )
  }
  const rate = gstRateBps ?? category.gstRateBps

  await tx
    .update(products)
    .set({
      status: 'approved',
      gstRateBps: rate,
      hsnCode,
      rejectionReason: null,
      // The first publication; a later approval keeps it, and with it the
      // product's web address.
      publishedAt: product.publishedAt ?? sql`now()`,
    })
    .where(eq(products.id, productId))
  await refreshProducts(tx, eq(products.id, productId))
  await tx
    .update(productModeration)
    .set({
      decision: 'approved',
      decidedBy: context.userId ?? null,
      decidedAt: sql`now()`,
    })
    .where(eq(productModeration.id, review.id))
  await recordAuditEntry(tx, {
    ...administratorActor(context),
    action: 'product.approve',
    entityType: 'product',
    entityId: productId,
    before: {
      status: product.status,
      gstRateBps: product.gstRateBps,
      hsnCode: product.hsnCode,
    },
    after: {
      status: 'approved',
      gstRateBps: rate,
      hsnCode,
      categoryGstRateBps: category.gstRateBps,
      reviewId: review.id,
    },
    ip,
  })
  // Step 18 (ai lane): queue the product's text and image embeddings here,
  // in this transaction.
  return getProductForReview(tx, photos, context, productId)
}

/**
 * Rejects a listing with a reason the seller sees; the seller can change it
 * and submit it again. Allowed before screening finishes. Administrators
 * only.
 */
export async function rejectProduct(
  tx: Transaction,
  photos: PhotoAddresses,
  context: RequestContext,
  productId: string,
  input: unknown,
  ip?: string | null,
): Promise<ProductForReview> {
  assertAdministrator(context)
  const { reason } = parseInput(rejection, input, 'That rejection is not valid')
  const { product, review } = await lockForDecision(tx, productId, {
    lockCategory: false,
  })
  await tx
    .update(products)
    .set({ status: 'rejected', rejectionReason: reason })
    .where(eq(products.id, productId))
  await tx
    .update(productModeration)
    .set({
      decision: 'rejected',
      decidedBy: context.userId ?? null,
      decidedAt: sql`now()`,
      reason,
    })
    .where(eq(productModeration.id, review.id))
  await recordAuditEntry(tx, {
    ...administratorActor(context),
    action: 'product.reject',
    entityType: 'product',
    entityId: productId,
    before: { status: product.status },
    after: { status: 'rejected', reason, reviewId: review.id },
    ip,
  })
  return getProductForReview(tx, photos, context, productId)
}

/**
 * Takes a listing that is on sale off the storefront, for example after a
 * complaint: it becomes rejected with a reason the seller sees, and the
 * seller can change it and submit it again. Administrators only.
 */
export async function takeDownProduct(
  tx: Transaction,
  photos: PhotoAddresses,
  context: RequestContext,
  productId: string,
  input: unknown,
  ip?: string | null,
): Promise<ProductForReview> {
  assertAdministrator(context)
  const { reason } = parseInput(rejection, input, 'That take-down is not valid')
  if (!isUuid(productId)) throw new NotFoundError(NOT_FOUND)
  const [product] = await tx
    .select()
    .from(products)
    .where(and(eq(products.id, productId), isNull(products.deletedAt)))
    .for('update')
  if (!product) throw new NotFoundError(NOT_FOUND)
  if (product.status !== 'approved') {
    throw new ConflictError('Only a listing that is on sale can be taken down')
  }
  await tx
    .update(products)
    .set({ status: 'rejected', rejectionReason: reason })
    .where(eq(products.id, productId))
  await invalidateStorefront(tx, { productIds: [productId] })
  await recordAuditEntry(tx, {
    ...administratorActor(context),
    action: 'product.take_down',
    entityType: 'product',
    entityId: productId,
    before: { status: product.status },
    after: { status: 'rejected', reason },
    ip,
  })
  return getProductForReview(tx, photos, context, productId)
}
