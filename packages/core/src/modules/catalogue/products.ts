import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm'
import type { Transaction } from '../../db/client.ts'
import type { RequestContext } from '../../db/context.ts'
import {
  brands,
  categories,
  productImages,
  productVariants,
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
  afterCursor,
  exactTime,
  newestFirstCursor,
  pageSize,
  toPage,
  type Page,
} from '../../lib/pagination.ts'
import { foreignKeyViolation, uniqueViolation } from '../../lib/postgres.ts'
import { slugify } from '../../lib/slug.ts'
import type { ObjectStorage } from '../../lib/storage.ts'
import { isUuid, parseInput } from '../../lib/validation.ts'
import { loadCategoryTree } from './categories.ts'
import { refreshProducts } from './summary.ts'
import {
  MAX_VARIANTS,
  newProduct,
  newVariant,
  PRODUCT_STATUSES,
  productUpdate,
  variantUpdate,
  type ImageStatus,
  type ImageView,
  type ProductListOptions,
  type ProductStatus,
  type ProductSummary,
  type ProductView,
  type VariantView,
} from './types.ts'

/*
 * A seller's listings and their variants (backend spec step 6, design doc
 * 5.5 and 6.2). Listing details change only while a product is a draft or
 * was rejected; a variant's price, MRP, stock, and active flag change at any
 * time, because they change daily in a real shop.
 *
 * Every change locks the product's row first and its variants after it, so
 * two changes to one product wait for each other instead of overwriting each
 * other's totals. Checkout (step 12) takes its locks in the same order.
 */

export type SellerContext = Extract<RequestContext, { role: 'seller' }>
/** Showing photos needs only their public addresses. */
export type PhotoAddresses = Pick<ObjectStorage, 'publicUrl'>

type ProductRow = typeof products.$inferSelect
type VariantRow = typeof productVariants.$inferSelect
type ImageRow = typeof productImages.$inferSelect

const INVALID = 'Those product details are not valid'
const INVALID_VARIANT = 'Those variant details are not valid'
const NOT_FOUND = 'There is no product with that id'
const EDITABLE: readonly ProductStatus[] = ['draft', 'rejected']

export const isProductStatus = (value: string): value is ProductStatus =>
  PRODUCT_STATUSES.some((status) => status === value)

const IMAGE_STATUSES: readonly ImageStatus[] = ['processing', 'ready', 'failed']
const isImageStatus = (value: string): value is ImageStatus =>
  IMAGE_STATUSES.some((status) => status === value)

export function assertSeller(
  context: RequestContext,
): asserts context is SellerContext {
  if (context.role !== 'seller') {
    throw new ForbiddenError('This needs a seller account')
  }
}

/**
 * Locks one of the seller's own products for a change, or 404. Another
 * seller's product is "not found" rather than "forbidden", so ids reveal
 * nothing.
 */
export async function lockOwnProduct(
  tx: Transaction,
  context: SellerContext,
  productId: string,
): Promise<ProductRow> {
  if (!isUuid(productId)) throw new NotFoundError(NOT_FOUND)
  const [row] = await tx
    .select()
    .from(products)
    .where(
      and(
        eq(products.id, productId),
        eq(products.sellerId, context.sellerId),
        isNull(products.deletedAt),
      ),
    )
    .for('update')
  if (!row) throw new NotFoundError(NOT_FOUND)
  return row
}

/** Listing details change only on a draft or a rejected product. */
export function assertEditable(product: ProductRow): void {
  if (!EDITABLE.some((status) => status === product.status)) {
    throw new ConflictError(
      'Listing details can change only while the product is a draft or after it was rejected',
    )
  }
}

export function throwIfAny(message: string, issues: (string | null)[]): void {
  const found = issues.filter((issue) => issue !== null)
  if (found.length > 0) throw new ValidationError(message, found)
}

/** bamboo-toothbrush-pack-of-4-3f9a2c: readable, and unique by the id. */
const productSlug = (title: string, id: string) =>
  `${slugify(title, 'product').slice(0, 50).replace(/-+$/, '')}-${id.slice(0, 6)}`

/** A problem with the category a product is listed in, or null. */
async function categoryIssue(
  tx: Transaction,
  categoryId: string,
): Promise<string | null> {
  const tree = await loadCategoryTree(tx)
  if (!tree.byId(categoryId)) return 'categoryId is not an existing category'
  if (!tree.isVisible(categoryId)) return 'categoryId is not active'
  if (tree.childrenOf(categoryId).length > 0) {
    return 'categoryId has subcategories; choose the most specific one'
  }
  return null
}

async function brandIssue(
  tx: Transaction,
  brandId: string,
): Promise<string | null> {
  const [brand] = await tx
    .select({ isActive: brands.isActive })
    .from(brands)
    .where(eq(brands.id, brandId))
  if (!brand) return 'brandId is not an existing brand'
  return brand.isActive ? null : 'brandId is not active'
}

function optionNameIssue(names: string[]): string | null {
  const lower = names.map((name) => name.toLowerCase())
  return new Set(lower).size === lower.length
    ? null
    : 'optionNames must not repeat a name'
}

interface VariantShape {
  sku: string
  options: Record<string, string>
  pricePaise: number
  mrpPaise: number
}

const sameText = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** The option values in name order, ignoring capital letters. */
const combination = (names: string[], options: Record<string, string>) =>
  JSON.stringify(names.map((name) => options[name]?.toLowerCase()))

/** Problems with one variant, next to the product's `others`. */
function variantIssues(
  label: string,
  variant: VariantShape,
  optionNames: string[],
  others: VariantShape[],
): string[] {
  const issues: string[] = []
  for (const name of optionNames) {
    if (!(name in variant.options)) {
      issues.push(`${label}.options needs a value for ${name}`)
    }
  }
  for (const key of Object.keys(variant.options)) {
    if (!optionNames.includes(key)) {
      issues.push(
        `${label}.options has ${key}, which is not one of the option names`,
      )
    }
  }
  if (variant.mrpPaise < variant.pricePaise) {
    issues.push(`${label}.mrpPaise must be at least pricePaise`)
  }
  if (others.some((other) => sameText(other.sku, variant.sku))) {
    issues.push(`${label}.sku is already used by another variant`)
  }
  if (
    optionNames.length > 0 &&
    others.some(
      (other) =>
        combination(optionNames, other.options) ===
        combination(optionNames, variant.options),
    )
  ) {
    issues.push(`${label}.options are the same as another variant's`)
  }
  return issues
}

function toVariantView(row: VariantRow): VariantView {
  return {
    id: row.id,
    sku: row.sku,
    options: row.options,
    pricePaise: row.pricePaise,
    mrpPaise: row.mrpPaise,
    stock: row.stock,
    isActive: row.isActive,
  }
}

function toImageView(row: ImageRow, photos: PhotoAddresses): ImageView {
  if (!isImageStatus(row.status)) {
    throw new Error(`Photo ${row.id} has an unknown status ${row.status}`)
  }
  const url = (size: 'thumb' | 'card' | 'gallery') =>
    photos.publicUrl(imageSizeKey(row.storageKey, size))
  return {
    id: row.id,
    status: row.status,
    alt: row.alt,
    sortOrder: row.sortOrder,
    variantId: row.variantId,
    width: row.width,
    height: row.height,
    failureReason: row.failureReason,
    urls:
      row.status === 'ready'
        ? { thumb: url('thumb'), card: url('card'), gallery: url('gallery') }
        : null,
  }
}

/** One product with its variants and photos, for the seller who owns it. */
export async function readProductView(
  tx: Transaction,
  photos: PhotoAddresses,
  productId: string,
): Promise<ProductView> {
  const [row] = await tx
    .select({ product: products, brandName: brands.name })
    .from(products)
    .leftJoin(brands, eq(brands.id, products.brandId))
    .where(eq(products.id, productId))
  if (!row) throw new NotFoundError(NOT_FOUND)
  const { product } = row
  if (!isProductStatus(product.status)) {
    throw new Error(`Product ${product.id} has an unknown status`)
  }
  const variants = await tx
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, productId))
    .orderBy(
      asc(productVariants.sortOrder),
      asc(productVariants.createdAt),
      asc(productVariants.id),
    )
  const images = await tx
    .select()
    .from(productImages)
    .where(eq(productImages.productId, productId))
    .orderBy(
      asc(productImages.sortOrder),
      asc(productImages.createdAt),
      asc(productImages.id),
    )
  const tree = await loadCategoryTree(tx)
  const category = tree.byId(product.categoryId)
  if (!category) throw new Error(`Product ${product.id} has no category`)

  return {
    id: product.id,
    slug: product.slug,
    status: product.status,
    title: product.title,
    description: product.description,
    highlights: product.highlights,
    attributes: product.attributes,
    optionNames: product.optionNames,
    hsnCode: product.hsnCode,
    gstRateBps: product.gstRateBps,
    category: {
      id: category.id,
      name: category.name,
      path: tree.pathTo(category.id).map((c) => c.name),
      gstRateBps: category.gstRateBps,
      defaultHsnCode: category.defaultHsnCode,
    },
    brand:
      product.brandId && row.brandName
        ? { id: product.brandId, name: row.brandName }
        : null,
    minPricePaise: product.minPricePaise,
    maxPricePaise: product.maxPricePaise,
    minMrpPaise: product.minMrpPaise,
    totalStock: product.totalStock,
    rejectionReason: product.rejectionReason,
    publishedAt: product.publishedAt,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    variants: variants.map(toVariantView),
    images: images.map((image) => toImageView(image, photos)),
  }
}

/** Creates a draft listing with its variants. */
export async function createProduct(
  tx: Transaction,
  photos: PhotoAddresses,
  context: RequestContext,
  input: unknown,
): Promise<ProductView> {
  assertSeller(context)
  const details = parseInput(newProduct, input, INVALID)
  const optionNames = details.optionNames ?? []
  const variants = details.variants.map((variant) => ({
    ...variant,
    options: variant.options ?? {},
  }))
  throwIfAny(INVALID, [
    optionNameIssue(optionNames),
    ...variants.flatMap((variant, index) =>
      variantIssues(
        `variants.${index}`,
        variant,
        optionNames,
        variants.slice(0, index),
      ),
    ),
    optionNames.length === 0 && variants.length > 1
      ? 'variants must have exactly one entry when there are no option names'
      : null,
    await categoryIssue(tx, details.categoryId),
    details.brandId ? await brandIssue(tx, details.brandId) : null,
  ])

  const id = randomUUID()
  try {
    await tx.insert(products).values({
      id,
      sellerId: context.sellerId,
      categoryId: details.categoryId,
      brandId: details.brandId ?? null,
      title: details.title,
      slug: productSlug(details.title, id),
      description: details.description ?? '',
      highlights: details.highlights ?? [],
      attributes: details.attributes ?? {},
      optionNames,
      hsnCode: details.hsnCode ?? null,
      status: 'draft',
    })
  } catch (error) {
    if (uniqueViolation(error) === 'products_slug_unique') {
      throw new ConflictError(
        'Another product got the same web address at the same moment; try again',
      )
    }
    throw error
  }
  await tx.insert(productVariants).values(
    variants.map((variant, sortOrder) => ({
      productId: id,
      sortOrder,
      sku: variant.sku,
      options: variant.options,
      pricePaise: variant.pricePaise,
      mrpPaise: variant.mrpPaise,
      stock: variant.stock,
      isActive: variant.isActive ?? true,
    })),
  )
  await refreshProducts(tx, eq(products.id, id))
  return readProductView(tx, photos, id)
}

/** One of the seller's own products. */
export async function getOwnProduct(
  tx: Transaction,
  photos: PhotoAddresses,
  context: RequestContext,
  productId: string,
): Promise<ProductView> {
  assertSeller(context)
  if (!isUuid(productId)) throw new NotFoundError(NOT_FOUND)
  const [owned] = await tx
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.id, productId),
        eq(products.sellerId, context.sellerId),
        isNull(products.deletedAt),
      ),
    )
  if (!owned) throw new NotFoundError(NOT_FOUND)
  return readProductView(tx, photos, productId)
}

/** The seller's products, newest first, optionally by status. */
export async function listOwnProducts(
  tx: Transaction,
  photos: PhotoAddresses,
  context: RequestContext,
  options: ProductListOptions = {},
): Promise<Page<ProductSummary>> {
  assertSeller(context)
  const { status } = options
  if (status !== undefined && !isProductStatus(status)) {
    throw new ValidationError(
      `status must be one of ${PRODUCT_STATUSES.join(', ')}`,
    )
  }
  const limit = pageSize(options.limit)
  const conditions: SQL[] = [
    eq(products.sellerId, context.sellerId),
    isNull(products.deletedAt),
    ...(status ? [eq(products.status, status)] : []),
    ...(options.cursor
      ? [afterCursor(options.cursor, products.createdAt, products.id)]
      : []),
  ]
  const rows = await tx
    .select({
      id: products.id,
      slug: products.slug,
      title: products.title,
      status: products.status,
      categoryName: categories.name,
      minPricePaise: products.minPricePaise,
      maxPricePaise: products.maxPricePaise,
      totalStock: products.totalStock,
      thumbnailKey: productImages.storageKey,
      createdAt: products.createdAt,
      updatedAt: products.updatedAt,
      cursorTime: exactTime(products.createdAt),
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(productImages, eq(productImages.id, products.primaryImageId))
    .where(and(...conditions))
    .orderBy(desc(products.createdAt), desc(products.id))
    .limit(limit + 1)
  return toPage(
    rows,
    limit,
    ({ cursorTime: _cursor, thumbnailKey, status: rowStatus, ...row }) => {
      if (!isProductStatus(rowStatus)) {
        throw new Error(`Product ${row.id} has an unknown status`)
      }
      return {
        ...row,
        status: rowStatus,
        thumbnailUrl: thumbnailKey
          ? photos.publicUrl(imageSizeKey(thumbnailKey, 'thumb'))
          : null,
      }
    },
    newestFirstCursor,
  )
}

/** The variants of a locked product, locked too. */
const lockVariants = (tx: Transaction, productId: string) =>
  tx
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, productId))
    .orderBy(
      asc(productVariants.sortOrder),
      asc(productVariants.createdAt),
      asc(productVariants.id),
    )
    .for('update')

/**
 * Changes listing details of a draft or rejected product. New option names
 * rename the old ones in order, in every variant too.
 */
export async function updateProduct(
  tx: Transaction,
  photos: PhotoAddresses,
  context: RequestContext,
  productId: string,
  input: unknown,
): Promise<ProductView> {
  assertSeller(context)
  const changes = parseInput(productUpdate, input, INVALID)
  if (Object.keys(changes).length === 0) {
    throw new ValidationError('There is nothing to change')
  }
  const current = await lockOwnProduct(tx, context, productId)
  assertEditable(current)
  const renamed = changes.optionNames
  throwIfAny(INVALID, [
    changes.categoryId !== undefined &&
    changes.categoryId !== current.categoryId
      ? await categoryIssue(tx, changes.categoryId)
      : null,
    changes.brandId && changes.brandId !== current.brandId
      ? await brandIssue(tx, changes.brandId)
      : null,
    renamed && renamed.length !== current.optionNames.length
      ? `optionNames can be renamed but not added or removed, so it needs ${current.optionNames.length} names`
      : null,
    renamed ? optionNameIssue(renamed) : null,
  ])

  if (renamed) {
    for (const variant of await lockVariants(tx, productId)) {
      const options = Object.fromEntries(
        current.optionNames.map((name, index) => [
          renamed[index],
          variant.options[name] ?? '',
        ]),
      )
      await tx
        .update(productVariants)
        .set({ options })
        .where(eq(productVariants.id, variant.id))
    }
  }
  await tx
    .update(products)
    .set({
      ...changes,
      // The address follows the title until the product is first published.
      ...(changes.title !== undefined && current.publishedAt === null
        ? { slug: productSlug(changes.title, productId) }
        : {}),
    })
    .where(eq(products.id, productId))
  await refreshProducts(tx, eq(products.id, productId))
  return readProductView(tx, photos, productId)
}

/** Deletes a draft or rejected product (soft delete, design doc 5.1). */
export async function deleteProduct(
  tx: Transaction,
  context: RequestContext,
  productId: string,
): Promise<void> {
  assertSeller(context)
  const current = await lockOwnProduct(tx, context, productId)
  if (!EDITABLE.some((status) => status === current.status)) {
    throw new ConflictError(
      'Only a draft or rejected product can be deleted; a product that was on sale is archived instead',
    )
  }
  await tx
    .update(products)
    .set({ deletedAt: sql`now()` })
    .where(eq(products.id, productId))
}

/** Adds a variant to a draft or rejected product. */
export async function addVariant(
  tx: Transaction,
  photos: PhotoAddresses,
  context: RequestContext,
  productId: string,
  input: unknown,
): Promise<ProductView> {
  assertSeller(context)
  const details = parseInput(newVariant, input, INVALID_VARIANT)
  const variant = { ...details, options: details.options ?? {} }
  const product = await lockOwnProduct(tx, context, productId)
  assertEditable(product)
  const existing = await lockVariants(tx, productId)
  throwIfAny(INVALID_VARIANT, [
    product.optionNames.length === 0
      ? 'A product without option names has exactly one variant'
      : null,
    existing.length >= MAX_VARIANTS
      ? `A product can have at most ${MAX_VARIANTS} variants`
      : null,
    ...variantIssues('variant', variant, product.optionNames, existing),
  ])
  await tx.insert(productVariants).values({
    productId,
    // After the others, in the seller's order.
    sortOrder: Math.max(-1, ...existing.map((other) => other.sortOrder)) + 1,
    sku: variant.sku,
    options: variant.options,
    pricePaise: variant.pricePaise,
    mrpPaise: variant.mrpPaise,
    stock: variant.stock,
    isActive: variant.isActive ?? true,
  })
  await refreshProducts(tx, eq(products.id, productId))
  return readProductView(tx, photos, productId)
}

const sameOptions = (a: Record<string, string>, b: Record<string, string>) =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(a).every(([name, value]) => b[name] === value)

/**
 * Changes a variant. Price, MRP, stock, and the active flag change at any
 * time; the SKU and options only while listing details may change.
 */
export async function updateVariant(
  tx: Transaction,
  photos: PhotoAddresses,
  context: RequestContext,
  productId: string,
  variantId: string,
  input: unknown,
): Promise<ProductView> {
  assertSeller(context)
  const changes = parseInput(variantUpdate, input, INVALID_VARIANT)
  if (Object.keys(changes).length === 0) {
    throw new ValidationError('There is nothing to change')
  }
  const product = await lockOwnProduct(tx, context, productId)
  const variants = await lockVariants(tx, productId)
  const current = variants.find((variant) => variant.id === variantId)
  if (!current) throw new NotFoundError('There is no variant with that id')

  const merged = {
    sku: changes.sku ?? current.sku,
    options: changes.options ?? current.options,
    pricePaise: changes.pricePaise ?? current.pricePaise,
    mrpPaise: changes.mrpPaise ?? current.mrpPaise,
  }
  if (
    merged.sku !== current.sku ||
    !sameOptions(merged.options, current.options)
  ) {
    assertEditable(product)
  }
  throwIfAny(
    INVALID_VARIANT,
    variantIssues(
      'variant',
      merged,
      product.optionNames,
      variants.filter((variant) => variant.id !== variantId),
    ),
  )
  await tx
    .update(productVariants)
    .set(changes)
    .where(eq(productVariants.id, variantId))
  await refreshProducts(tx, eq(products.id, productId))
  return readProductView(tx, photos, productId)
}

/**
 * Deletes a variant of a draft or rejected product. A variant that an order
 * or a cart refers to is deactivated instead.
 */
export async function deleteVariant(
  tx: Transaction,
  photos: PhotoAddresses,
  context: RequestContext,
  productId: string,
  variantId: string,
): Promise<ProductView> {
  assertSeller(context)
  const product = await lockOwnProduct(tx, context, productId)
  assertEditable(product)
  const variants = await lockVariants(tx, productId)
  if (!variants.some((variant) => variant.id === variantId)) {
    throw new NotFoundError('There is no variant with that id')
  }
  if (variants.length === 1) {
    throw new ConflictError(
      'A product needs at least one variant; delete the product instead',
    )
  }
  // Photos of this variant stay, as photos of the whole product.
  await tx
    .update(productImages)
    .set({ variantId: null })
    .where(eq(productImages.variantId, variantId))
  try {
    await tx.delete(productVariants).where(eq(productVariants.id, variantId))
  } catch (error) {
    // Orders and carts belong to other modules; their foreign keys answer.
    if (foreignKeyViolation(error)) {
      throw new ConflictError(
        'This variant is in an order or a cart; deactivate it instead',
      )
    }
    throw error
  }
  await refreshProducts(tx, eq(products.id, productId))
  return readProductView(tx, photos, productId)
}
