import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool } from '../../db/pool.ts'
import {
  categories,
  productImages,
  productVariants,
  products,
  sellers,
} from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import { NotFoundError } from '../../errors.ts'
import { validationIssues } from '../../testing/errors.ts'
import { createTestBrand, createTestSeller } from '../../testing/fixtures.ts'
import {
  getCategoryPage,
  getHomePage,
  getPublicProduct,
  listPublicProducts,
  NEW_ARRIVALS,
  type ProductListQuery,
} from './storefront.ts'
import { refreshProducts } from './summary.ts'
import type { ProductCard } from './storefront-types.ts'

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'storefront-test',
)
const webPool = createPool(requireEnv('DATABASE_URL'), 'storefront-test')
const owner = createDatabase(ownerPool)
const web = createDatabase(webPool)
const photos = { publicUrl: (key: string) => `https://images.test/${key}` }
const anonymous: RequestContext = { role: 'anonymous' }

afterAll(async () => {
  await Promise.all([ownerPool.end(), webPool.end()])
})

const suffix = () => randomUUID().replaceAll('-', '').slice(0, 10)

type CategoryRow = typeof categories.$inferSelect

async function category(
  parent?: CategoryRow,
  values: Partial<typeof categories.$inferInsert> = {},
): Promise<CategoryRow> {
  const name = suffix()
  const [row] = await owner
    .insert(categories)
    .values({
      name: `Category ${name}`,
      slug: `category-${name}`,
      gstRateBps: 500,
      parentId: parent?.id ?? null,
      depth: parent ? parent.depth + 1 : 0,
      ...values,
    })
    .returning()
  return row!
}

interface VariantSpec {
  pricePaise: number
  mrpPaise?: number
  stock?: number
  isActive?: boolean
  options?: Record<string, string>
}

interface ProductSpec {
  categoryId: string
  sellerId?: string
  brandId?: string
  title?: string
  status?: 'draft' | 'pending_review' | 'approved' | 'rejected' | 'archived'
  publishedAt?: Date
  deleted?: boolean
  optionNames?: string[]
  variants?: VariantSpec[]
}

let seller: { id: string }

beforeAll(async () => {
  seller = (await createTestSeller(owner)).seller
})

/**
 * A product inserted as the database owner, with its summary fields built by
 * the real refreshProducts. One variant at ₹500 (MRP ₹600), 5 in stock, by
 * default.
 */
async function listed(spec: ProductSpec) {
  const id = randomUUID()
  const name = suffix()
  const status = spec.status ?? 'approved'
  await owner.insert(products).values({
    id,
    sellerId: spec.sellerId ?? seller.id,
    categoryId: spec.categoryId,
    brandId: spec.brandId ?? null,
    title: spec.title ?? `Steel bottle ${name}`,
    slug: `steel-bottle-${name}`,
    status,
    publishedAt:
      spec.publishedAt ??
      (status === 'approved' || status === 'archived' ? new Date() : null),
    optionNames: spec.optionNames ?? [],
    deletedAt: spec.deleted ? new Date() : null,
    hsnCode: '7323',
    gstRateBps: 500,
  })
  const variants = await owner
    .insert(productVariants)
    .values(
      (spec.variants ?? [{ pricePaise: 50_000 }]).map((variant, index) => ({
        productId: id,
        sku: `SKU-${index}`,
        options: variant.options ?? {},
        pricePaise: variant.pricePaise,
        mrpPaise: variant.mrpPaise ?? variant.pricePaise,
        stock: variant.stock ?? 5,
        isActive: variant.isActive ?? true,
        sortOrder: index,
      })),
    )
    .returning()
  await refresh(id)
  const [product] = await owner
    .select()
    .from(products)
    .where(eq(products.id, id))
  return { product: product!, variants }
}

const refresh = (id: string) =>
  owner.transaction((tx) => refreshProducts(tx, eq(products.id, id)))

async function readyPhoto(
  productId: string,
  values: Partial<typeof productImages.$inferInsert> = {},
) {
  const id = randomUUID()
  const [row] = await owner
    .insert(productImages)
    .values({
      id,
      productId,
      storageKey: `images/${id}`,
      status: 'ready',
      contentHash: 'hash',
      width: 1200,
      height: 900,
      ...values,
    })
    .returning()
  await refresh(productId)
  return row!
}

const list = (query: ProductListQuery, context: RequestContext = anonymous) =>
  withContext(web, context, (tx) => listPublicProducts(tx, photos, query))

const ids = (cards: ProductCard[]) => cards.map((card) => card.id)

/** Every page of a list, following its cursors. */
async function allPages(query: ProductListQuery): Promise<string[]> {
  const seen: string[] = []
  let cursor: string | undefined
  for (let page = 0; page < 50; page++) {
    const result = await list({ ...query, ...(cursor ? { cursor } : {}) })
    seen.push(...ids(result.items))
    if (!result.nextCursor) return seen
    cursor = result.nextCursor
  }
  throw new Error('Too many pages')
}

const productPage = (slug: string, context: RequestContext = anonymous) =>
  withContext(web, context, (tx) => getPublicProduct(tx, photos, slug))

const categoryPage = (slug: string, query: Record<string, string> = {}) =>
  withContext(web, anonymous, (tx) => getCategoryPage(tx, photos, slug, query))

describe('product page', () => {
  test('shows the listing, its active variants, and ready photos in order', async () => {
    const top = await category()
    const middle = await category(top)
    const leaf = await category(middle)
    const brand = await createTestBrand(owner)
    const { product, variants } = await listed({
      categoryId: leaf.id,
      brandId: brand.id,
      optionNames: ['Size'],
      variants: [
        {
          pricePaise: 45_000,
          mrpPaise: 50_000,
          stock: 0,
          options: { Size: '500 ml' },
        },
        {
          pricePaise: 60_000,
          mrpPaise: 70_000,
          stock: 3,
          options: { Size: '1 litre' },
        },
        {
          pricePaise: 80_000,
          stock: 9,
          isActive: false,
          options: { Size: '2 litre' },
        },
      ],
    })
    const second = await readyPhoto(product.id, { sortOrder: 2, alt: 'Side' })
    const first = await readyPhoto(product.id, {
      sortOrder: 1,
      alt: 'Front',
      variantId: variants[1]!.id,
    })
    await owner.insert(productImages).values({
      productId: product.id,
      storageKey: `images/${randomUUID()}`,
      status: 'processing',
      sortOrder: 0,
    })

    const page = await productPage(product.slug)

    expect(page).toMatchObject({
      id: product.id,
      title: product.title,
      category: { id: leaf.id, slug: leaf.slug },
      breadcrumbs: [top, middle, leaf].map(({ id, name, slug }) => ({
        id,
        name,
        slug,
      })),
      brand: { id: brand.id, name: brand.name, slug: brand.slug },
      seller: { id: seller.id },
      minPricePaise: 45_000,
      maxPricePaise: 60_000,
      minMrpPaise: 50_000,
      inStock: true,
      ratingAvg: 0,
      ratingCount: 0,
    })
    expect(page.variants).toEqual([
      {
        id: variants[0]!.id,
        options: { Size: '500 ml' },
        pricePaise: 45_000,
        mrpPaise: 50_000,
        inStock: false,
      },
      {
        id: variants[1]!.id,
        options: { Size: '1 litre' },
        pricePaise: 60_000,
        mrpPaise: 70_000,
        inStock: true,
      },
    ])
    expect(page.images.map((image) => image.id)).toEqual([first.id, second.id])
    expect(page.images[0]).toEqual({
      id: first.id,
      alt: 'Front',
      variantId: variants[1]!.id,
      width: 1200,
      height: 900,
      urls: {
        thumb: `https://images.test/images/${first.id}/thumb.webp`,
        card: `https://images.test/images/${first.id}/card.webp`,
        gallery: `https://images.test/images/${first.id}/gallery.webp`,
      },
    })
    // Private details never reach visitors.
    expect(JSON.stringify(page)).not.toMatch(/sku|SKU-|"stock"|hsn|gstRate/i)
  })

  test('is not found unless the product, its seller, and its categories are all on sale', async () => {
    const top = await category()
    const leaf = await category(top)
    const suspended = (await createTestSeller(owner, 'suspended')).seller
    const pending = (await createTestSeller(owner, 'pending')).seller
    const hiddenTop = await category(undefined, { isActive: false })
    const underHidden = await category(hiddenTop)
    const inactiveLeaf = await category(top, { isActive: false })

    const hidden = await Promise.all([
      listed({ categoryId: leaf.id, status: 'draft' }),
      listed({ categoryId: leaf.id, status: 'pending_review' }),
      listed({ categoryId: leaf.id, status: 'rejected' }),
      listed({ categoryId: leaf.id, status: 'archived' }),
      listed({ categoryId: leaf.id, deleted: true }),
      listed({ categoryId: leaf.id, sellerId: suspended.id }),
      listed({ categoryId: leaf.id, sellerId: pending.id }),
      listed({ categoryId: underHidden.id }),
      listed({ categoryId: inactiveLeaf.id }),
    ])
    for (const { product } of hidden) {
      await expect(productPage(product.slug)).rejects.toThrow(NotFoundError)
    }
    await expect(productPage('no-such-product')).rejects.toThrow(NotFoundError)
    await expect(productPage('Not A Slug!')).rejects.toThrow(NotFoundError)
  })

  test('an approved product without a publication time is not on sale', async () => {
    const leaf = await category()
    const { product } = await listed({ categoryId: leaf.id })
    await owner
      .update(products)
      .set({ publishedAt: null })
      .where(eq(products.id, product.id))
    await expect(productPage(product.slug)).rejects.toThrow(NotFoundError)
    const listing = await list({
      filters: { categoryIds: [leaf.id], includeOutOfStock: true },
      sort: 'newest',
    })
    expect(listing.items).toEqual([])
  })

  test('a signed-in seller does not see their own unpublished product either', async () => {
    const leaf = await category()
    const { product } = await listed({ categoryId: leaf.id, status: 'draft' })
    const own = await owner
      .select({ owner: sellers.ownerUserId })
      .from(sellers)
      .where(eq(sellers.id, seller.id))
    const context: RequestContext = {
      role: 'seller',
      userId: own[0]!.owner,
      sellerId: seller.id,
    }
    await expect(productPage(product.slug, context)).rejects.toThrow(
      NotFoundError,
    )
    const page = await list(
      {
        filters: { categoryIds: [leaf.id], includeOutOfStock: true },
        sort: 'newest',
      },
      context,
    )
    expect(page.items).toEqual([])
  })

  test('a product with every variant inactive keeps its page but leaves every list', async () => {
    const leaf = await category()
    const { product } = await listed({
      categoryId: leaf.id,
      variants: [{ pricePaise: 30_000, isActive: false }],
    })
    const page = await productPage(product.slug)
    expect(page).toMatchObject({
      minPricePaise: null,
      maxPricePaise: null,
      inStock: false,
      variants: [],
    })
    const listing = await list({
      filters: { categoryIds: [leaf.id], includeOutOfStock: true },
      sort: 'newest',
    })
    expect(listing.items).toEqual([])
  })

  test('an inactive brand is left off the page', async () => {
    const leaf = await category()
    const brand = await createTestBrand(owner, false)
    const { product } = await listed({ categoryId: leaf.id, brandId: brand.id })
    expect((await productPage(product.slug)).brand).toBeNull()
  })
})

describe('product lists', () => {
  test('a card shows the summary, the brand, and the main photo', async () => {
    const leaf = await category()
    const brand = await createTestBrand(owner)
    const { product } = await listed({
      categoryId: leaf.id,
      brandId: brand.id,
      variants: [
        { pricePaise: 20_000, mrpPaise: 25_000 },
        { pricePaise: 30_000, mrpPaise: 30_000 },
      ],
      optionNames: ['Size'],
    })
    const photo = await readyPhoto(product.id, { alt: 'Bottle' })
    const { items } = await list({
      filters: { categoryIds: [leaf.id] },
      sort: 'newest',
    })
    expect(items).toEqual([
      {
        id: product.id,
        slug: product.slug,
        title: product.title,
        brand: { name: brand.name, slug: brand.slug },
        minPricePaise: 20_000,
        maxPricePaise: 30_000,
        minMrpPaise: 25_000,
        inStock: true,
        ratingAvg: 0,
        ratingCount: 0,
        image: {
          id: photo.id,
          alt: 'Bottle',
          variantId: null,
          width: 1200,
          height: 900,
          urls: {
            thumb: `https://images.test/images/${photo.id}/thumb.webp`,
            card: `https://images.test/images/${photo.id}/card.webp`,
            gallery: `https://images.test/images/${photo.id}/gallery.webp`,
          },
        },
      },
    ])
  })

  test('hides products out of stock unless asked to include them', async () => {
    const leaf = await category()
    const inStock = await listed({ categoryId: leaf.id })
    const soldOut = await listed({
      categoryId: leaf.id,
      variants: [{ pricePaise: 10_000, stock: 0 }],
    })
    expect(
      ids(
        (await list({ filters: { categoryIds: [leaf.id] }, sort: 'newest' }))
          .items,
      ),
    ).toEqual([inStock.product.id])
    const all = await list({
      filters: { categoryIds: [leaf.id], includeOutOfStock: true },
      sort: 'price_asc',
    })
    expect(ids(all.items)).toEqual([soldOut.product.id, inStock.product.id])
    expect(all.items[0]!.inStock).toBe(false)
  })

  test('filters by brand and by the price on the card', async () => {
    const leaf = await category()
    const [bambooHome, terra] = await Promise.all([
      createTestBrand(owner),
      createTestBrand(owner),
    ])
    const cheap = await listed({
      categoryId: leaf.id,
      brandId: bambooHome.id,
      variants: [{ pricePaise: 19_900 }, { pricePaise: 99_900 }],
      optionNames: ['Pack'],
    })
    const middle = await listed({
      categoryId: leaf.id,
      brandId: terra.id,
      variants: [{ pricePaise: 45_000 }],
    })
    const dear = await listed({
      categoryId: leaf.id,
      variants: [{ pricePaise: 90_000 }],
    })
    const inLeaf = { categoryIds: [leaf.id] }

    expect(
      ids(
        (
          await list({
            filters: { ...inLeaf, brandIds: [bambooHome.id] },
            sort: 'price_asc',
          })
        ).items,
      ),
    ).toEqual([cheap.product.id])
    expect(
      ids(
        (
          await list({
            filters: { ...inLeaf, brandIds: [bambooHome.id, terra.id] },
            sort: 'price_asc',
          })
        ).items,
      ),
    ).toEqual([cheap.product.id, middle.product.id])
    // ₹199 is the card's price, so ₹999 for the larger pack does not count.
    expect(
      ids(
        (
          await list({
            filters: { ...inLeaf, minPricePaise: 40_000 },
            sort: 'price_asc',
          })
        ).items,
      ),
    ).toEqual([middle.product.id, dear.product.id])
    expect(
      ids(
        (
          await list({
            filters: { ...inLeaf, maxPricePaise: 45_000 },
            sort: 'price_asc',
          })
        ).items,
      ),
    ).toEqual([cheap.product.id, middle.product.id])
    expect(
      ids(
        (
          await list({
            filters: {
              ...inLeaf,
              minPricePaise: 45_000,
              maxPricePaise: 45_000,
            },
            sort: 'price_asc',
          })
        ).items,
      ),
    ).toEqual([middle.product.id])
    expect(
      (await list({ filters: { categoryIds: [] }, sort: 'newest' })).items,
    ).toEqual([])
  })

  test('sorts newest first by first publication, and by price both ways', async () => {
    const leaf = await category()
    const base = Date.now()
    const older = await listed({
      categoryId: leaf.id,
      publishedAt: new Date(base - 60_000),
      variants: [{ pricePaise: 30_000 }],
    })
    const newer = await listed({
      categoryId: leaf.id,
      publishedAt: new Date(base),
      variants: [{ pricePaise: 10_000 }],
    })
    const oldest = await listed({
      categoryId: leaf.id,
      publishedAt: new Date(base - 120_000),
      variants: [{ pricePaise: 20_000 }],
    })
    const filters = { categoryIds: [leaf.id] }

    expect(ids((await list({ filters, sort: 'newest' })).items)).toEqual(
      [newer, older, oldest].map((p) => p.product.id),
    )
    expect(ids((await list({ filters, sort: 'price_asc' })).items)).toEqual(
      [newer, oldest, older].map((p) => p.product.id),
    )
    expect(ids((await list({ filters, sort: 'price_desc' })).items)).toEqual(
      [older, oldest, newer].map((p) => p.product.id),
    )
  })

  test('pages never repeat or skip products that tie on price or time', async () => {
    const leaf = await category()
    const sameTime = new Date()
    const made = []
    for (let index = 0; index < 7; index++) {
      made.push(
        await listed({
          categoryId: leaf.id,
          publishedAt: sameTime,
          variants: [{ pricePaise: index < 4 ? 25_000 : 35_000 }],
        }),
      )
    }
    const everyId = made.map((p) => p.product.id).toSorted()
    for (const sort of ['newest', 'price_asc', 'price_desc'] as const) {
      const seen = await allPages({
        filters: { categoryIds: [leaf.id] },
        sort,
        limit: 2,
      })
      expect(seen).toHaveLength(7)
      expect(seen.toSorted()).toEqual(everyId)
    }
  })

  test('the newest-first cursor keeps microseconds', async () => {
    const leaf = await category()
    // Three products published within the same millisecond.
    const [a, b, c] = await Promise.all(
      [1, 2, 3].map(() => listed({ categoryId: leaf.id })),
    )
    // Microseconds apart: a cursor rounded to milliseconds would repeat or skip one.
    const stamps = ['000001', '000002', '000003']
    for (const [index, made] of [a, b, c].entries()) {
      await owner.execute(
        sql`update products set published_at = ${`2026-10-11T10:00:00.${stamps[index]}Z`}::timestamptz where id = ${made!.product.id}`,
      )
    }
    const seen = await allPages({
      filters: { categoryIds: [leaf.id] },
      sort: 'newest',
      limit: 1,
    })
    expect(seen.toSorted()).toEqual(
      [a, b, c].map((p) => p!.product.id).toSorted(),
    )
  })

  test('a cursor from another order is refused', async () => {
    const leaf = await category()
    await listed({ categoryId: leaf.id })
    await listed({ categoryId: leaf.id })
    const { nextCursor } = await list({
      filters: { categoryIds: [leaf.id] },
      sort: 'newest',
      limit: 1,
    })
    expect(nextCursor).not.toBeNull()
    await expect(
      list({
        filters: { categoryIds: [leaf.id] },
        sort: 'price_asc',
        cursor: nextCursor!,
      }),
    ).rejects.toThrow('That page cursor is not valid')
    await expect(
      list({
        filters: { categoryIds: [leaf.id] },
        sort: 'newest',
        cursor: 'nonsense',
      }),
    ).rejects.toThrow('That page cursor is not valid')
  })
})

describe('category page', () => {
  test('lists the category and everything below it, with breadcrumbs and subcategories', async () => {
    const top = await category()
    const kitchen = await category(top, { sortOrder: 1 })
    const storage = await category(top, { sortOrder: 2 })
    const closed = await category(top, { sortOrder: 3, isActive: false })
    const bamboo = await category(kitchen)
    const other = await category()
    const inBamboo = await listed({
      categoryId: bamboo.id,
      variants: [{ pricePaise: 10_000 }],
    })
    const inStorage = await listed({
      categoryId: storage.id,
      variants: [{ pricePaise: 20_000 }],
    })
    await listed({ categoryId: closed.id })
    await listed({ categoryId: other.id })

    const page = await categoryPage(top.slug, { sort: 'price_asc' })
    expect(page.category).toEqual({
      id: top.id,
      name: top.name,
      slug: top.slug,
      breadcrumbs: [{ id: top.id, name: top.name, slug: top.slug }],
      children: [kitchen, storage].map(({ id, name, slug }) => ({
        id,
        name,
        slug,
      })),
    })
    expect(ids(page.items)).toEqual([inBamboo.product.id, inStorage.product.id])
    expect(page.nextCursor).toBeNull()

    const leafPage = await categoryPage(bamboo.slug)
    expect(leafPage.category.breadcrumbs.map((c) => c.id)).toEqual([
      top.id,
      kitchen.id,
      bamboo.id,
    ])
    expect(ids(leafPage.items)).toEqual([inBamboo.product.id])
  })

  test('takes filters from the query string', async () => {
    const leaf = await category()
    const brand = await createTestBrand(owner)
    const branded = await listed({
      categoryId: leaf.id,
      brandId: brand.id,
      variants: [{ pricePaise: 15_000 }],
    })
    await listed({ categoryId: leaf.id, variants: [{ pricePaise: 15_000 }] })
    const soldOut = await listed({
      categoryId: leaf.id,
      brandId: brand.id,
      variants: [{ pricePaise: 12_000, stock: 0 }],
    })

    const page = await categoryPage(leaf.slug, {
      brand: ` ${brand.slug} ,`,
      maxPricePaise: '20000',
      includeOutOfStock: 'true',
      sort: 'price_desc',
      limit: '1',
    })
    expect(ids(page.items)).toEqual([branded.product.id])
    const next = await categoryPage(leaf.slug, {
      brand: brand.slug,
      maxPricePaise: '20000',
      includeOutOfStock: 'true',
      sort: 'price_desc',
      cursor: page.nextCursor!,
    })
    expect(ids(next.items)).toEqual([soldOut.product.id])
  })

  test('explains filters it cannot use', async () => {
    const leaf = await category()
    const inactive = await createTestBrand(owner, false)
    const issues = (query: Record<string, string>) =>
      validationIssues(categoryPage(leaf.slug, query))

    expect(await issues({ sort: 'cheapest' })).toEqual([
      'sort must be one of newest, price_asc, price_desc',
    ])
    expect(await issues({ sort: 'relevance' })).toEqual([
      'sort must be one of newest, price_asc, price_desc',
    ])
    expect(await issues({ minPricePaise: '12.5' })).toEqual([
      'minPricePaise must be a whole number',
    ])
    expect(
      await issues({ minPricePaise: '500', maxPricePaise: '100' }),
    ).toEqual(['minPricePaise must not be more than maxPricePaise'])
    expect(await issues({ includeOutOfStock: 'yes' })).toEqual([
      'includeOutOfStock must be one of true, false',
    ])
    expect(await issues({ brand: 'no-such-brand' })).toEqual([
      'brand no-such-brand is not a brand on sale',
    ])
    expect(await issues({ brand: inactive.slug })).toEqual([
      `brand ${inactive.slug} is not a brand on sale`,
    ])
    expect(await issues({ brand: 'Not A Slug' })).toEqual([
      'brand.0 must be lowercase letters and digits joined by single hyphens, like kitchen-and-dining',
    ])
    expect(
      await issues({
        brand: Array.from({ length: 11 }, (_, i) => `b${i}`).join(','),
      }),
    ).toEqual(['brand can name at most 10 brands'])
    expect(await issues({ limit: '0' })).toEqual(['limit must be at least 1'])
    expect(await issues({ colour: 'green' })).toEqual([
      'colour is not allowed here',
    ])
  })

  test('is not found for an unknown or hidden category', async () => {
    const hiddenTop = await category(undefined, { isActive: false })
    const below = await category(hiddenTop)
    await expect(categoryPage('no-such-category')).rejects.toThrow(
      NotFoundError,
    )
    await expect(categoryPage(hiddenTop.slug)).rejects.toThrow(NotFoundError)
    await expect(categoryPage(below.slug)).rejects.toThrow(NotFoundError)
  })
})

describe('home page', () => {
  test('shows the newest products in stock, then a row per top-level category', async () => {
    const top = await category()
    const leaf = await category(top)
    const emptyTop = await category()
    // Published in the future, so no other test file's products are newer.
    const future = Date.now() + 365 * 24 * 60 * 60 * 1000
    const made = []
    for (let index = 0; index < NEW_ARRIVALS + 2; index++) {
      made.push(
        await listed({
          categoryId: leaf.id,
          publishedAt: new Date(future + index * 1000),
        }),
      )
    }
    await listed({
      categoryId: leaf.id,
      publishedAt: new Date(future + 100_000),
      variants: [{ pricePaise: 10_000, stock: 0 }],
    })
    await listed({
      categoryId: emptyTop.id,
      variants: [{ pricePaise: 10_000, stock: 0 }],
    })

    const sections = await withContext(web, anonymous, (tx) =>
      getHomePage(tx, photos),
    )

    expect(sections[0]!.kind).toBe('new_arrivals')
    expect(ids(sections[0]!.products)).toEqual(
      made
        .toReversed()
        .slice(0, NEW_ARRIVALS)
        .map((p) => p.product.id),
    )
    const row = sections.find((section) => section.category?.id === top.id)
    expect(row).toMatchObject({
      kind: 'category',
      category: { slug: top.slug },
    })
    expect(ids(row!.products)).toEqual(
      made
        .toReversed()
        .slice(0, 8)
        .map((p) => p.product.id),
    )
    expect(
      sections.some((section) => section.category?.id === emptyTop.id),
    ).toBe(false)
  })
})
