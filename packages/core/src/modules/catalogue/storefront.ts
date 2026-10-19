import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  notInArray,
  sql,
  type SQL,
} from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import type { Transaction } from '../../db/client.ts'
import {
  brands,
  productImages,
  productVariants,
  productVideos,
  products,
} from '../../db/schema/index.ts'
import { NotFoundError, ValidationError } from '../../errors.ts'
import { imageSizeKey, type ImageSize } from '../../lib/images.ts'
import { formatRupees } from '../../lib/money.ts'
import { videoFileKey, videoPosterKey } from '../../lib/videos.ts'
import {
  afterKeyCursor,
  encodeKeyCursor,
  exactTime,
  MAX_PAGE_SIZE,
  toPage,
  type CursorKeyType,
  type Page,
} from '../../lib/pagination.ts'
import {
  parseInput,
  slug as slugFormat,
  strictObject,
  wholeNumber,
} from '../../lib/validation.ts'
import { getPublicSellers, sellerIsApproved } from '../sellers/service.ts'
import { loadCategoryTree } from './categories.ts'
import type { PhotoAddresses } from './products.ts'
import type { CategoryTree } from './tree.ts'
import {
  MAX_BRAND_FILTERS,
  STOREFRONT_PAGE_SIZE,
  STOREFRONT_SORTS,
  type CategoryLink,
  type CategoryPage,
  type HomeSection,
  type ProductCard,
  type ProductFilters,
  type PublicImage,
  type PublicProduct,
  type PublicVideo,
  type StorefrontSort,
} from './storefront-types.ts'
import { MAX_PRICE_PAISE, type CategoryView } from './types.ts'

/*
 * The public side of the catalogue (backend spec step 9, design doc 6.8 and
 * 7): product pages, category pages, the home page, and the one product list
 * they and search share.
 *
 * Callers run these as the anonymous context, so a cached answer never
 * depends on who asked. Every query still checks for itself that the product
 * is approved and not deleted, its seller is approved, and its category and
 * every category above it are active: row-level security would also show a
 * signed-in seller their own drafts, and it does not know about categories.
 */

type Tree = CategoryTree<CategoryView>

const NO_PRODUCT = 'There is no product at that address'
const NO_CATEGORY = 'There is no category at that address'
const INVALID = 'Those filters are not valid'

/** The home page: 12 new arrivals, then 8 per top-level category. */
export const NEW_ARRIVALS = 12
export const PER_HOME_CATEGORY = 8

const link = (category: CategoryView): CategoryLink => ({
  id: category.id,
  name: category.name,
  slug: category.slug,
})

/** The conditions every public read shares; see the comment at the top. */
function onSale(tree: Tree): SQL[] {
  const hidden = tree.categories
    .filter((category) => !tree.isVisible(category.id))
    .map((category) => category.id)
  return [
    eq(products.status, 'approved'),
    // Approval sets it (step 7); "newest" sorts by it.
    isNotNull(products.publishedAt),
    isNull(products.deletedAt),
    sellerIsApproved(products.sellerId),
    ...(hidden.length > 0 ? [notInArray(products.categoryId, hidden)] : []),
  ]
}

function publicVideo(
  photos: PhotoAddresses,
  video: typeof productVideos.$inferSelect,
): PublicVideo {
  const { width, height, durationMs } = video
  // The ready check in the database makes these always present.
  if (width === null || height === null || durationMs === null) {
    throw new Error(`Ready video ${video.id} has no size`)
  }
  return {
    url: photos.publicUrl(videoFileKey(video.storageKey)),
    posterUrl: photos.publicUrl(videoPosterKey(video.storageKey)),
    width,
    height,
    durationMs,
  }
}

function publicImage(
  photos: PhotoAddresses,
  image: {
    id: string
    storageKey: string
    alt: string
    variantId: string | null
    width: number | null
    height: number | null
  },
): PublicImage {
  if (image.width === null || image.height === null) {
    throw new Error(`Ready photo ${image.id} has no size`)
  }
  const url = (size: ImageSize) =>
    photos.publicUrl(imageSizeKey(image.storageKey, size))
  return {
    id: image.id,
    alt: image.alt,
    variantId: image.variantId,
    width: image.width,
    height: image.height,
    urls: { thumb: url('thumb'), card: url('card'), gallery: url('gallery') },
  }
}

/* Product lists. */

/** How a list matches search words; category and home pages have none. */
export interface WordMatch {
  /** `exact`: full-text words; `similar`: word similarity, for typos. */
  kind: 'exact' | 'similar'
  text: string
}

/**
 * How a list matches by closeness of meaning, over the product embeddings
 * (step 18): the products nearest a search query's embedding, the products
 * with a photo nearest an uploaded photo's, or the products nearest one
 * product's own text, for its similar products.
 */
export type VectorMatch =
  | { kind: 'meaning'; embedding: number[] }
  | { kind: 'photo'; embedding: number[] }
  | { kind: 'like'; productId: string }

export type ListMatch = WordMatch | VectorMatch

export type ListSort = StorefrontSort | 'relevance'

export interface ProductListQuery {
  filters: ProductFilters
  match?: ListMatch
  /** `relevance` needs a match. */
  sort: ListSort
  cursor?: string
  limit?: number
}

/*
 * Products matching search words, with their rank, from the database
 * functions in migration 0011. Full-text and trigram operators cannot use
 * their indexes under row-level security, so the functions match as the
 * table owner and return only ids of products visitors may see anyway; this
 * query joins them and still applies every check of its own.
 */
const MATCHED = sql.raw('matched')

/*
 * A vector match takes the nearest embeddings through their HNSW index
 * first, then the list applies its filters to those candidates (design doc
 * 10: over-fetch, and search falls back to keyword search when too few are
 * left). Iterative scans keep reading the index while row-level security
 * filters out embeddings of products not on sale.
 */
export const VECTOR_CANDIDATES = 400

const vector = (embedding: number[]) =>
  sql`${JSON.stringify(embedding)}::vector`

/** Closeness from 0 to 1, as numeric so a cursor repeats it exactly. */
const closeness = (distance: SQL) => sql`(1 - (${distance}))::numeric`

function nearestText(target: SQL, exceptProductId?: string): SQL {
  const distance = sql`e.embedding <=> ${target}`
  return sql`(
    select e.product_id, ${closeness(distance)} as rank
    from product_embeddings e
    where e.kind = 'text'${exceptProductId ? sql` and e.product_id <> ${exceptProductId}` : sql``}
    order by ${distance}
    limit ${VECTOR_CANDIDATES}
  )`
}

const isVectorMatch = (match: ListMatch | undefined): match is VectorMatch =>
  match !== undefined &&
  (match.kind === 'meaning' || match.kind === 'photo' || match.kind === 'like')

function matchingProducts(match: ListMatch): SQL {
  if (!isVectorMatch(match)) {
    return match.kind === 'exact'
      ? sql`app.public_products_with_words(${match.text}) as ${MATCHED}`
      : sql`app.public_products_with_similar_words(${match.text}) as ${MATCHED}`
  }
  if (match.kind === 'meaning') {
    return sql`${nearestText(vector(match.embedding))} as ${MATCHED}`
  }
  if (match.kind === 'like') {
    return sql`${nearestText(
      sql`(select s.embedding from product_embeddings s where s.product_id = ${match.productId} and s.kind = 'text')`,
      match.productId,
    )} as ${MATCHED}`
  }
  // A product is as close as its closest photo, and is listed once.
  const distance = sql`e.embedding <=> ${vector(match.embedding)}`
  return sql`(
    select c.product_id, max(c.rank) as rank
    from (
      select e.product_id, ${closeness(distance)} as rank
      from product_embeddings e
      where e.kind = 'image'
      order by ${distance}
      limit ${VECTOR_CANDIDATES}
    ) c
    group by c.product_id
  ) as ${MATCHED}`
}

interface Ordering {
  key: AnyPgColumn | SQL
  /** The key as text for the cursor. */
  keyText: SQL<string>
  direction: 'asc' | 'desc'
  /**
   * Where nulls would go. Listed rows never have a null key, but PostgreSQL
   * reads an index in order only if the placement matches it: the newest
   * indexes are DESC NULLS LAST, and the price indexes ASC NULLS LAST, which
   * read backwards give DESC NULLS FIRST.
   */
  nulls: 'first' | 'last'
  type: CursorKeyType
}

function ordering(sort: ListSort, match: ListMatch | undefined): Ordering {
  if (sort === 'newest') {
    return {
      key: products.publishedAt,
      keyText: exactTime(products.publishedAt),
      direction: 'desc',
      nulls: 'last',
      type: 'timestamptz',
    }
  }
  if (sort === 'relevance') {
    if (!match) throw new Error('Sorting by relevance needs search words')
    const key = sql`${MATCHED}.rank`
    return {
      key,
      keyText: sql<string>`${key}::text`,
      direction: 'desc',
      nulls: 'last',
      type: 'numeric',
    }
  }
  return {
    key: products.minPricePaise,
    keyText: sql<string>`${products.minPricePaise}::text`,
    direction: sort === 'price_asc' ? 'asc' : 'desc',
    nulls: sort === 'price_asc' ? 'last' : 'first',
    type: 'bigint',
  }
}

/** A cursor names its sort and kind of match, so it only continues that list. */
const orderName = (sort: ListSort, match: ListMatch | undefined) =>
  match ? `${match.kind}-${sort}` : sort

const ordered = (column: AnyPgColumn | SQL, order: Ordering) =>
  sql`${column} ${sql.raw(order.direction)} nulls ${sql.raw(order.nulls)}`

/**
 * One page of products on sale, for category pages, the home page, and
 * search. `tree` saves loading the category tree again when the caller
 * already has it.
 */
export async function listPublicProducts(
  tx: Transaction,
  photos: PhotoAddresses,
  query: ProductListQuery,
  tree?: Tree,
): Promise<Page<ProductCard>> {
  const { filters, match, sort } = query
  const limit = Math.min(query.limit ?? STOREFRONT_PAGE_SIZE, MAX_PAGE_SIZE)
  if (
    filters.productIds?.length === 0 ||
    filters.categoryIds?.length === 0 ||
    filters.brandIds?.length === 0
  ) {
    return { items: [], nextCursor: null }
  }
  const order = ordering(sort, match)
  const name = orderName(sort, match)
  if (isVectorMatch(match)) {
    // For this transaction only: enough candidates from the index, read
    // in order until that many are left after row-level security.
    await tx.execute(
      sql`select set_config('hnsw.ef_search', ${String(VECTOR_CANDIDATES)}, true), set_config('hnsw.iterative_scan', 'strict_order', true)`,
    )
  }
  const conditions: SQL[] = [
    ...onSale(tree ?? (await loadCategoryTree(tx))),
    // A product with no active variant has no price to show or sort by.
    isNotNull(products.minPricePaise),
    ...(filters.includeOutOfStock ? [] : [eq(products.inStock, true)]),
    ...(filters.productIds ? [inArray(products.id, filters.productIds)] : []),
    ...(filters.categoryIds
      ? [inArray(products.categoryId, filters.categoryIds)]
      : []),
    ...(filters.brandIds ? [inArray(products.brandId, filters.brandIds)] : []),
    ...(filters.minPricePaise === undefined
      ? []
      : [gte(products.minPricePaise, filters.minPricePaise)]),
    ...(filters.maxPricePaise === undefined
      ? []
      : [lte(products.minPricePaise, filters.maxPricePaise)]),
    ...(query.cursor
      ? [
          afterKeyCursor(
            query.cursor,
            name,
            order.key,
            products.id,
            order.direction,
            order.type,
          ),
        ]
      : []),
  ]
  const select = tx
    .select({
      id: products.id,
      slug: products.slug,
      title: products.title,
      minPricePaise: products.minPricePaise,
      maxPricePaise: products.maxPricePaise,
      minMrpPaise: products.minMrpPaise,
      inStock: products.inStock,
      ratingAvg: products.ratingAvg,
      ratingCount: products.ratingCount,
      minOrderQuantity: products.minOrderQuantity,
      brandName: brands.name,
      brandSlug: brands.slug,
      imageId: productImages.id,
      imageKey: productImages.storageKey,
      imageAlt: productImages.alt,
      imageVariantId: productImages.variantId,
      imageWidth: productImages.width,
      imageHeight: productImages.height,
      cursorKey: order.keyText,
    })
    .from(products)
    .leftJoin(
      brands,
      and(eq(brands.id, products.brandId), eq(brands.isActive, true)),
    )
    .leftJoin(
      productImages,
      and(
        eq(productImages.id, products.primaryImageId),
        eq(productImages.status, 'ready'),
      ),
    )
    .$dynamic()
  const rows = await (
    match
      ? select.innerJoin(
          matchingProducts(match),
          sql`${MATCHED}.product_id = ${products.id}`,
        )
      : select
  )
    .where(and(...conditions))
    .orderBy(ordered(order.key, order), ordered(products.id, order))
    .limit(limit + 1)

  return toPage(
    rows,
    limit,
    (row): ProductCard => {
      const { minPricePaise, maxPricePaise, minMrpPaise } = row
      if (
        minPricePaise === null ||
        maxPricePaise === null ||
        minMrpPaise === null
      ) {
        throw new Error(`Listed product ${row.id} has no price`)
      }
      return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        brand:
          row.brandName !== null && row.brandSlug !== null
            ? { name: row.brandName, slug: row.brandSlug }
            : null,
        minPricePaise,
        maxPricePaise,
        minMrpPaise,
        inStock: row.inStock === true,
        ratingAvg: Number(row.ratingAvg),
        ratingCount: row.ratingCount,
        minOrderQuantity: row.minOrderQuantity,
        image:
          row.imageId !== null && row.imageKey !== null
            ? publicImage(photos, {
                id: row.imageId,
                storageKey: row.imageKey,
                alt: row.imageAlt ?? '',
                variantId: row.imageVariantId,
                width: row.imageWidth,
                height: row.imageHeight,
              })
            : null,
      }
    },
    (row) => encodeKeyCursor(name, row.cursorKey, row.id),
  )
}

/* Filters from a request's query string. */

/** A whole number written in a query string, for example `limit=24`. */
export const wholeNumberText = (min: number, max?: number) =>
  z
    .string()
    .regex(/^\d{1,15}$/, 'must be a whole number')
    .transform(Number)
    .pipe(wholeNumber(min, max))

const brandSlugs = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== ''),
  )
  .pipe(
    z
      .array(slugFormat)
      .min(1, 'must name at least one brand')
      .max(MAX_BRAND_FILTERS, `can name at most ${MAX_BRAND_FILTERS} brands`),
  )

/** The query parameters every storefront list takes (backend spec step 9). */
export const listingParameters = {
  brand: brandSlugs.optional(),
  minPricePaise: wholeNumberText(0, MAX_PRICE_PAISE).optional(),
  maxPricePaise: wholeNumberText(0, MAX_PRICE_PAISE).optional(),
  includeOutOfStock: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  cursor: z.string().max(1000).optional(),
  // Larger values are cut to the largest page, like every other list.
  limit: wholeNumberText(1)
    .transform((value) => Math.min(value, MAX_PAGE_SIZE))
    .optional(),
}

const listing = strictObject(listingParameters)
export type ListingParameters = z.output<typeof listing>

const categoryListing = strictObject({
  ...listingParameters,
  sort: z.enum(STOREFRONT_SORTS).optional(),
})

/** A query string as the services take it; a repeated name keeps its last value. */
export const queryObject = (query: URLSearchParams): Record<string, string> =>
  Object.fromEntries(query)

export function priceRangeIssue(parameters: {
  minPricePaise?: number | undefined
  maxPricePaise?: number | undefined
}): void {
  const { minPricePaise: min, maxPricePaise: max } = parameters
  if (min !== undefined && max !== undefined && min > max) {
    throw new ValidationError(INVALID, [
      'minPricePaise must not be more than maxPricePaise',
    ])
  }
}

/** The ids of active brands by slug; an unknown or inactive one answers 400. */
export async function activeBrandIds(
  tx: Transaction,
  slugs: readonly string[],
): Promise<string[]> {
  const rows = await tx
    .select({ id: brands.id, slug: brands.slug })
    .from(brands)
    .where(and(inArray(brands.slug, [...slugs]), eq(brands.isActive, true)))
  const unknown = slugs.filter((slug) => !rows.some((row) => row.slug === slug))
  if (unknown.length > 0) {
    throw new ValidationError(INVALID, [
      `brand ${unknown.join(', ')} ${unknown.length === 1 ? 'is not a brand on sale' : 'are not brands on sale'}`,
    ])
  }
  return rows.map((row) => row.id)
}

/**
 * The active brand with this name, ignoring capital letters, for a brand a
 * shopper named in a sentence (step 18), or null.
 */
export async function findActiveBrandByName(
  tx: Transaction,
  name: string,
): Promise<{ id: string; name: string; slug: string } | null> {
  const [row] = await tx
    .select({ id: brands.id, name: brands.name, slug: brands.slug })
    .from(brands)
    .where(
      and(
        sql`lower(${brands.name}) = lower(${name.trim()})`,
        eq(brands.isActive, true),
      ),
    )
    .orderBy(asc(brands.name))
    .limit(1)
  return row ?? null
}

/** The filters of a listing, with brand slugs turned into ids. */
export async function listingFilters(
  tx: Transaction,
  parameters: ListingParameters,
): Promise<ProductFilters> {
  priceRangeIssue(parameters)
  return {
    ...(parameters.brand
      ? { brandIds: await activeBrandIds(tx, parameters.brand) }
      : {}),
    ...(parameters.minPricePaise === undefined
      ? {}
      : { minPricePaise: parameters.minPricePaise }),
    ...(parameters.maxPricePaise === undefined
      ? {}
      : { maxPricePaise: parameters.maxPricePaise }),
    includeOutOfStock: parameters.includeOutOfStock ?? false,
  }
}

/* Pages. */

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** A product page by its web address name. */
export async function getPublicProduct(
  tx: Transaction,
  photos: PhotoAddresses,
  productSlug: string,
): Promise<PublicProduct> {
  if (productSlug.length > 100 || !SLUG.test(productSlug)) {
    throw new NotFoundError(NO_PRODUCT)
  }
  const tree = await loadCategoryTree(tx)
  const [row] = await tx
    .select({
      id: products.id,
      slug: products.slug,
      title: products.title,
      description: products.description,
      highlights: products.highlights,
      attributes: products.attributes,
      optionNames: products.optionNames,
      categoryId: products.categoryId,
      sellerId: products.sellerId,
      minPricePaise: products.minPricePaise,
      maxPricePaise: products.maxPricePaise,
      minMrpPaise: products.minMrpPaise,
      inStock: products.inStock,
      ratingAvg: products.ratingAvg,
      ratingCount: products.ratingCount,
      minOrderQuantity: products.minOrderQuantity,
      publishedAt: products.publishedAt,
      brandId: brands.id,
      brandName: brands.name,
      brandSlug: brands.slug,
    })
    .from(products)
    .leftJoin(
      brands,
      and(eq(brands.id, products.brandId), eq(brands.isActive, true)),
    )
    .where(and(eq(products.slug, productSlug), ...onSale(tree)))
  if (!row) throw new NotFoundError(NO_PRODUCT)
  const seller = (await getPublicSellers(tx, [row.sellerId])).get(row.sellerId)
  const category = tree.byId(row.categoryId)
  if (!seller || !category || row.publishedAt === null) {
    throw new NotFoundError(NO_PRODUCT)
  }

  const variants = await tx
    .select({
      id: productVariants.id,
      options: productVariants.options,
      pricePaise: productVariants.pricePaise,
      mrpPaise: productVariants.mrpPaise,
      stock: productVariants.stock,
    })
    .from(productVariants)
    .where(
      and(
        eq(productVariants.productId, row.id),
        eq(productVariants.isActive, true),
      ),
    )
    .orderBy(
      asc(productVariants.sortOrder),
      asc(productVariants.createdAt),
      asc(productVariants.id),
    )
  const images = await tx
    .select()
    .from(productImages)
    .where(
      and(
        eq(productImages.productId, row.id),
        eq(productImages.status, 'ready'),
      ),
    )
    .orderBy(
      asc(productImages.sortOrder),
      asc(productImages.createdAt),
      asc(productImages.id),
    )
  const [video] = await tx
    .select()
    .from(productVideos)
    .where(
      and(
        eq(productVideos.productId, row.id),
        eq(productVideos.status, 'ready'),
      ),
    )
  // A variant with fewer left than the minimum order cannot be bought.
  const publicVariants = variants.map(({ stock, ...variant }) => ({
    ...variant,
    inStock: stock >= row.minOrderQuantity,
  }))

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    highlights: row.highlights,
    attributes: row.attributes,
    optionNames: row.optionNames,
    category: link(category),
    breadcrumbs: tree.pathTo(category.id).map(link),
    brand:
      row.brandId !== null && row.brandName !== null && row.brandSlug !== null
        ? { id: row.brandId, name: row.brandName, slug: row.brandSlug }
        : null,
    seller,
    minPricePaise: row.minPricePaise,
    maxPricePaise: row.maxPricePaise,
    minMrpPaise: row.minMrpPaise,
    inStock: publicVariants.some((variant) => variant.inStock),
    ratingAvg: Number(row.ratingAvg),
    ratingCount: row.ratingCount,
    minOrderQuantity: row.minOrderQuantity,
    publishedAt: row.publishedAt,
    variants: publicVariants,
    images: images.map((image) => publicImage(photos, image)),
    video: video ? publicVideo(photos, video) : null,
  }
}

/**
 * A category page: the category with its breadcrumbs and subcategories, and
 * a page of the products in it and everything below it. `query` is the
 * request's query string (see `listingParameters`, plus `sort`).
 */
export async function getCategoryPage(
  tx: Transaction,
  photos: PhotoAddresses,
  categorySlug: string,
  query: Record<string, string>,
): Promise<CategoryPage> {
  const parameters = parseInput(categoryListing, query, INVALID)
  const tree = await loadCategoryTree(tx)
  const category = tree.bySlug(categorySlug)
  if (!category || !tree.isVisible(category.id)) {
    throw new NotFoundError(NO_CATEGORY)
  }
  const filters = await listingFilters(tx, parameters)
  const page = await listPublicProducts(
    tx,
    photos,
    {
      filters: { ...filters, categoryIds: tree.subtreeIds(category.id) },
      sort: parameters.sort ?? 'newest',
      ...(parameters.cursor ? { cursor: parameters.cursor } : {}),
      ...(parameters.limit ? { limit: parameters.limit } : {}),
    },
    tree,
  )
  return {
    category: {
      ...link(category),
      breadcrumbs: tree.pathTo(category.id).map(link),
      children: tree
        .childrenOf(category.id)
        .filter((child) => child.isActive)
        .map(link),
    },
    ...page,
  }
}

/**
 * The home page: the newest products in stock, then a row for each
 * top-level category with its newest products. A category with nothing in
 * stock gets no row.
 */
export async function getHomePage(
  tx: Transaction,
  photos: PhotoAddresses,
): Promise<HomeSection[]> {
  const tree = await loadCategoryTree(tx)
  const newest = (filters: ProductFilters, limit: number) =>
    listPublicProducts(tx, photos, { filters, sort: 'newest', limit }, tree)

  const sections: HomeSection[] = [
    {
      kind: 'new_arrivals',
      category: null,
      products: (await newest({}, NEW_ARRIVALS)).items,
    },
  ]
  for (const top of tree.childrenOf(null)) {
    if (!top.isActive) continue
    const { items } = await newest(
      { categoryIds: tree.subtreeIds(top.id) },
      PER_HOME_CATEGORY,
    )
    if (items.length > 0) {
      sections.push({ kind: 'category', category: link(top), products: items })
    }
  }
  return sections
}

/** How many similar products a product page shows. */
export const SIMILAR_PRODUCTS = 8

export interface SimilarProducts {
  productId: string
  /** The list changes with the products in this category. */
  categoryId: string
  items: ProductCard[]
}

/**
 * The products on sale and in stock nearest in meaning to the one at
 * `productSlug`, in its own category (design doc 6.8), nearest first. It
 * needs no AI call, because both sides' embeddings are stored; the list is
 * empty until the product has been embedded. 404 unless the product is on
 * sale.
 */
export async function listSimilarProducts(
  tx: Transaction,
  photos: PhotoAddresses,
  productSlug: string,
): Promise<SimilarProducts> {
  if (productSlug.length > 100 || !SLUG.test(productSlug)) {
    throw new NotFoundError(NO_PRODUCT)
  }
  const tree = await loadCategoryTree(tx)
  const [product] = await tx
    .select({ id: products.id, categoryId: products.categoryId })
    .from(products)
    .where(and(eq(products.slug, productSlug), ...onSale(tree)))
  if (!product) throw new NotFoundError(NO_PRODUCT)
  const { items } = await listPublicProducts(
    tx,
    photos,
    {
      filters: { categoryIds: [product.categoryId] },
      match: { kind: 'like', productId: product.id },
      sort: 'relevance',
      limit: SIMILAR_PRODUCTS,
    },
    tree,
  )
  return { productId: product.id, categoryId: product.categoryId, items }
}

/* For other modules: the shopping assistant (step 20). */

/** The longest description the assistant is given; the start says the most. */
const MAX_FACTS_DESCRIPTION = 800

/** What the shopping assistant may say about a product, and nothing more. */
export interface ProductFacts {
  id: string
  title: string
  brand: string | null
  category: string
  /** Prices as shoppers read them, for example ₹1,299. */
  price: string
  mrp: string
  inStock: boolean
  rating: { average: number; count: number } | null
  highlights: string[]
  attributes: Record<string, string>
  /** Each option and its values, for example { "Colour": ["Blue", "Green"] }. */
  options: Record<string, string[]>
  description: string
}

/**
 * The facts of the products on sale among `ids`, in the order of `ids`;
 * those not on sale are left out. Only what the product page shows.
 */
export async function getProductFacts(
  tx: Transaction,
  ids: readonly string[],
): Promise<ProductFacts[]> {
  if (ids.length === 0) return []
  const tree = await loadCategoryTree(tx)
  const rows = await tx
    .select({
      id: products.id,
      title: products.title,
      brandName: brands.name,
      categoryId: products.categoryId,
      minPricePaise: products.minPricePaise,
      maxPricePaise: products.maxPricePaise,
      minMrpPaise: products.minMrpPaise,
      inStock: products.inStock,
      ratingAvg: products.ratingAvg,
      ratingCount: products.ratingCount,
      highlights: products.highlights,
      attributes: products.attributes,
      optionNames: products.optionNames,
      description: products.description,
    })
    .from(products)
    .leftJoin(
      brands,
      and(eq(brands.id, products.brandId), eq(brands.isActive, true)),
    )
    .where(
      and(
        inArray(products.id, [...new Set(ids)]),
        isNotNull(products.minPricePaise),
        ...onSale(tree),
      ),
    )
  const variants = await tx
    .select({
      productId: productVariants.productId,
      options: productVariants.options,
    })
    .from(productVariants)
    .where(
      and(
        inArray(
          productVariants.productId,
          rows.map((row) => row.id),
        ),
        eq(productVariants.isActive, true),
      ),
    )
    .orderBy(asc(productVariants.createdAt))
  const byId = new Map(rows.map((row) => [row.id, row]))
  return ids.flatMap((id): ProductFacts[] => {
    const row = byId.get(id)
    if (
      !row ||
      row.minPricePaise === null ||
      row.maxPricePaise === null ||
      row.minMrpPaise === null
    ) {
      return []
    }
    const options = Object.fromEntries(
      row.optionNames.map((name) => [
        name,
        [
          ...new Set(
            variants
              .filter((variant) => variant.productId === id)
              .flatMap((variant) => variant.options[name] ?? []),
          ),
        ],
      ]),
    )
    const price =
      row.minPricePaise === row.maxPricePaise
        ? formatRupees(row.minPricePaise)
        : `${formatRupees(row.minPricePaise)} to ${formatRupees(row.maxPricePaise)}`
    return [
      {
        id,
        title: row.title,
        brand: row.brandName,
        category: tree.byId(row.categoryId)?.name ?? '',
        price,
        mrp: formatRupees(row.minMrpPaise),
        inStock: row.inStock === true,
        rating:
          row.ratingCount > 0
            ? { average: Number(row.ratingAvg), count: row.ratingCount }
            : null,
        highlights: row.highlights,
        attributes: row.attributes,
        options,
        description: row.description.trim().slice(0, MAX_FACTS_DESCRIPTION),
      },
    ]
  })
}

/* For other modules: reviews (step 16). */

/** A product as another module names it. */
export interface ProductLabel {
  id: string
  slug: string
  title: string
}

/**
 * The product on sale at `productSlug`, or null when visitors cannot see one
 * there, so reviews can be read and written only where the product page is.
 */
export async function findProductOnSale(
  tx: Transaction,
  productSlug: string,
): Promise<ProductLabel | null> {
  if (productSlug.length > 100 || !SLUG.test(productSlug)) return null
  const tree = await loadCategoryTree(tx)
  const [row] = await tx
    .select({ id: products.id, slug: products.slug, title: products.title })
    .from(products)
    .where(and(eq(products.slug, productSlug), ...onSale(tree)))
  return row ?? null
}

/** The products among `ids` the context may read, by id. */
export async function getProductLabels(
  tx: Transaction,
  ids: readonly string[],
): Promise<Map<string, ProductLabel>> {
  if (ids.length === 0) return new Map()
  const rows = await tx
    .select({ id: products.id, slug: products.slug, title: products.title })
    .from(products)
    .where(inArray(products.id, [...new Set(ids)]))
  return new Map(rows.map((row) => [row.id, row]))
}
