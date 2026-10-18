import { randomUUID } from 'node:crypto'
import { eq, gt, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import {
  cacheInvalidations,
  categories,
  products,
  sellers,
} from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import {
  deleteOldCacheInvalidations,
  INVALIDATION_OVERLAP_SECONDS,
  readCacheInvalidations,
  recordCacheInvalidations,
} from '../../lib/cache.ts'
import {
  createTestBrand,
  createTestCategory,
  createTestProduct,
  createTestSeller,
  createTestUser,
} from '../../testing/fixtures.ts'
import type { AccountDirectory } from '../auth/accounts.ts'
import {
  approveSeller,
  reinstateSeller,
  suspendSeller,
  updateOwnContacts,
  updateSeller,
} from '../sellers/service.ts'
import { deleteBrand, updateBrand } from './brands.ts'
import { createCategory, deleteCategory, updateCategory } from './categories.ts'
import { archiveProduct, moveToDraft, takeDownProduct } from './moderation.ts'
import { updateVariant } from './products.ts'
import {
  invalidateStorefront,
  MAX_PRODUCT_TAGS,
  storefrontTags,
  type StorefrontChange,
} from './storefront-cache.ts'
import { refreshProducts } from './summary.ts'

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'storefront-cache-test')
  pools.push(pool)
  return createDatabase(pool)
}
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))
const web = connect(requireEnv('DATABASE_URL'))
const worker = connect(requireEnv('WORKER_DATABASE_URL'))
const photos = { publicUrl: (key: string) => key }

let admin: Extract<RequestContext, { role: 'admin' }>
const system: RequestContext = { role: 'system' }

beforeAll(async () => {
  admin = { role: 'admin', userId: (await createTestUser(owner, 'admin')).id }
})

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()))
})

/** The newest log id, so a test reads only what came after it. */
async function mark(): Promise<number> {
  const [row] = await owner
    .select({
      id: sql<number>`coalesce(max(${cacheInvalidations.id}), 0)::int`,
    })
    .from(cacheInvalidations)
  return row!.id
}

const tagsAfter = async (since: number) =>
  (
    await owner
      .select({ tag: cacheInvalidations.tag })
      .from(cacheInvalidations)
      .where(gt(cacheInvalidations.id, since))
  ).map((row) => row.tag)

/** Whether `change` records the tag of the product's page. */
async function refreshes(
  productId: string,
  change: (productId: string) => Promise<unknown>,
): Promise<boolean> {
  const since = await mark()
  await change(productId)
  return (await tagsAfter(since)).includes(`product:${productId}`)
}

const asAdmin = <T>(work: Parameters<typeof withContext<T>>[2]) =>
  withContext(web, admin, work)

const record = (change: StorefrontChange, context: RequestContext = system) =>
  withContext(web, context, (tx) => invalidateStorefront(tx, change))

async function threeLevels() {
  const name = randomUUID().slice(0, 8)
  const insert = async (parentId: string | null, depth: number) => {
    const [row] = await owner
      .insert(categories)
      .values({
        name: `Level ${depth} ${name}`,
        slug: `level-${depth}-${name}`,
        gstRateBps: 500,
        parentId,
        depth,
      })
      .returning()
    return row!
  }
  const top = await insert(null, 0)
  const middle = await insert(top.id, 1)
  const leaf = await insert(middle.id, 2)
  return { top, middle, leaf }
}

describe('invalidateStorefront', () => {
  test('a product change records the product, its address, its category and the ones above it, and home', async () => {
    const { top, middle, leaf } = await threeLevels()
    const { seller } = await createTestSeller(owner)
    const { product } = await createTestProduct(owner, {
      sellerId: seller.id,
      categoryId: leaf.id,
      publishedAt: new Date(),
    })
    const since = await mark()
    await record({ productIds: [product.id, product.id] })
    const tags = await tagsAfter(since)
    // Other test files record tags at the same time, so only ours count.
    const ours = [product.id, product.slug, leaf.id, middle.id, top.id]
    expect(
      tags
        .filter((tag) => ours.some((id) => tag.endsWith(`:${id}`)))
        .toSorted(),
    ).toEqual(
      [
        `category:${leaf.id}`,
        `category:${middle.id}`,
        `category:${top.id}`,
        `product:${product.id}`,
        `product-slug:${product.slug}`,
      ].toSorted(),
    )
    expect(tags).toContain('home')
  })

  test('a seller, a content page, and everything have their own tags', async () => {
    const sellerId = randomUUID()
    const since = await mark()
    await record({ sellerId })
    await record({ contentSlug: 'returns' })
    await record('everything')
    expect(await tagsAfter(since)).toEqual(
      expect.arrayContaining([
        `seller:${sellerId}`,
        'content:returns',
        'catalogue',
      ]),
    )
    expect(storefrontTags.content('returns')).toBe('content:returns')
  })

  test(`more than ${MAX_PRODUCT_TAGS} products at once refresh everything instead`, async () => {
    const ids = Array.from({ length: MAX_PRODUCT_TAGS + 1 }, () => randomUUID())
    const since = await mark()
    await record({ productIds: ids })
    const tags = await tagsAfter(since)
    expect(tags).toContain('catalogue')
    expect(tags.some((tag) => ids.some((id) => tag === `product:${id}`))).toBe(
      false,
    )
  })

  test('records nothing if the change rolls back', async () => {
    const id = randomUUID()
    await expect(
      withContext(web, system, async (tx) => {
        await invalidateStorefront(tx, { productIds: [id] })
        throw new Error('the change failed')
      }),
    ).rejects.toThrow('the change failed')
    const rows = await owner
      .select()
      .from(cacheInvalidations)
      .where(eq(cacheInvalidations.tag, `product:${id}`))
    expect(rows).toEqual([])
  })
})

describe('changes that refresh the storefront', () => {
  test('refreshProducts records the tags of published products only', async () => {
    const category = await createTestCategory(owner)
    const { seller } = await createTestSeller(owner)
    const published = await createTestProduct(owner, {
      sellerId: seller.id,
      categoryId: category.id,
      publishedAt: new Date(),
    })
    const draft = await createTestProduct(owner, {
      sellerId: seller.id,
      categoryId: category.id,
      status: 'draft',
    })
    const since = await mark()
    await withContext(web, system, (tx) =>
      refreshProducts(
        tx,
        inArray(products.id, [published.product.id, draft.product.id]),
      ),
    )
    const tags = await tagsAfter(since)
    expect(tags).toContain(`product:${published.product.id}`)
    expect(tags).not.toContain(`product:${draft.product.id}`)
  })

  test('a seller changing the price of a product on sale refreshes its pages', async () => {
    const category = await createTestCategory(owner)
    const { owner: user, seller } = await createTestSeller(owner)
    const { product, variant } = await createTestProduct(owner, {
      sellerId: seller.id,
      categoryId: category.id,
      publishedAt: new Date(),
    })
    const context: RequestContext = {
      role: 'seller',
      userId: user.id,
      sellerId: seller.id,
    }
    const since = await mark()
    await withContext(web, context, (tx) =>
      updateVariant(tx, photos, context, product.id, variant.id, {
        pricePaise: 45_000,
      }),
    )
    expect(await tagsAfter(since)).toEqual(
      expect.arrayContaining([
        `product:${product.id}`,
        `category:${category.id}`,
        'home',
      ]),
    )
  })

  test('category and brand changes refresh everything', async () => {
    const brand = await createTestBrand(owner)
    const checks: (() => Promise<unknown>)[] = [
      async () => {
        const created = await asAdmin((tx) =>
          createCategory(tx, admin, {
            name: `Cache ${randomUUID().slice(0, 8)}`,
            gstRateBps: 500,
          }),
        )
        await asAdmin((tx) =>
          updateCategory(tx, admin, created.id, { name: `${created.name} 2` }),
        )
        return asAdmin((tx) => deleteCategory(tx, admin, created.id))
      },
      () =>
        asAdmin((tx) => updateBrand(tx, admin, brand.id, { isActive: false })),
      () => asAdmin((tx) => deleteBrand(tx, admin, brand.id)),
    ]
    for (const check of checks) {
      const since = await mark()
      await check()
      expect(await tagsAfter(since)).toContain('catalogue')
    }
  })

  test('seller approval, suspension, reinstatement, and a new display name refresh the storefront', async () => {
    const { owner: user, seller } = await createTestSeller(owner, 'pending')
    await owner
      .update(sellers)
      .set({ gstin: '27AAAPA1234A1Z5', pan: 'AAAPA1234A' })
      .where(eq(sellers.id, seller.id))
    const accounts: AccountDirectory = {
      findByEmail: () => Promise.reject(new Error('not used')),
      findById: () => Promise.reject(new Error('not used')),
      createSellerOwner: () => Promise.reject(new Error('not used')),
      remove: () => Promise.reject(new Error('not used')),
      ban: async () => {},
      unban: async () => {},
    }
    const services = { db: web, accounts }
    const refreshesEverything = async (change: () => Promise<unknown>) => {
      const since = await mark()
      await change()
      expect(await tagsAfter(since)).toContain('catalogue')
    }
    await refreshesEverything(() => approveSeller(web, admin, seller.id))
    await refreshesEverything(() =>
      suspendSeller(services, admin, seller.id, { reason: 'Fake listings' }),
    )
    await refreshesEverything(() => reinstateSeller(services, admin, seller.id))

    let since = await mark()
    await updateSeller(web, admin, seller.id, { displayName: 'Green Basket' })
    expect(await tagsAfter(since)).toContain(`seller:${seller.id}`)
    since = await mark()
    await updateOwnContacts(
      web,
      { role: 'seller', userId: user.id, sellerId: seller.id },
      { displayName: 'Green Basket Organics' },
    )
    expect(await tagsAfter(since)).toContain(`seller:${seller.id}`)
  })

  test('taking a listing off sale refreshes its pages; moving one not on sale does not', async () => {
    const category = await createTestCategory(owner)
    const { owner: user, seller } = await createTestSeller(owner)
    const context: RequestContext = {
      role: 'seller',
      userId: user.id,
      sellerId: seller.id,
    }
    const onSale = async () =>
      (
        await createTestProduct(owner, {
          sellerId: seller.id,
          categoryId: category.id,
        })
      ).product.id
    const asSeller = <T>(work: Parameters<typeof withContext<T>>[2]) =>
      withContext(web, context, work)
    expect(
      await refreshes(await onSale(), (id) =>
        asSeller((tx) => archiveProduct(tx, photos, context, id)),
      ),
    ).toBe(true)
    expect(
      await refreshes(await onSale(), (id) =>
        asSeller((tx) => moveToDraft(tx, photos, context, id)),
      ),
    ).toBe(true)
    expect(
      await refreshes(await onSale(), (id) =>
        asAdmin((tx) =>
          takeDownProduct(tx, photos, admin, id, {
            reason: 'Misleading photos',
          }),
        ),
      ),
    ).toBe(true)
    // An archived listing is not on the storefront, so nothing to refresh.
    const { product: archived } = await createTestProduct(owner, {
      sellerId: seller.id,
      categoryId: category.id,
      status: 'archived',
    })
    expect(
      await refreshes(archived.id, (id) =>
        asSeller((tx) => moveToDraft(tx, photos, context, id)),
      ),
    ).toBe(false)
  })
})

describe('the shared log', () => {
  test('reads what was recorded since the last read, looking a minute back again', async () => {
    const tag = `product:${randomUUID()}`
    const first = await readCacheInvalidations(web, null)
    await recordCacheInvalidations(web, [tag, tag])
    const second = await readCacheInvalidations(web, first.readAt)
    expect(second.rows.filter((row) => row.tag === tag)).toHaveLength(1)
    // The next read still sees it, inside the overlap; the handler skips it.
    const third = await readCacheInvalidations(web, second.readAt)
    expect(third.rows.some((row) => row.tag === tag)).toBe(true)
    expect(Date.parse(third.readAt)).toBeGreaterThanOrEqual(
      Date.parse(second.readAt),
    )
    expect(INVALIDATION_OVERLAP_SECONDS).toBe(60)
  })

  test('the worker deletes rows older than a day; the web app cannot delete', async () => {
    const old = `product:${randomUUID()}`
    const recent = `product:${randomUUID()}`
    await owner
      .insert(cacheInvalidations)
      .values([
        { tag: old, createdAt: sql`now() - interval '25 hours'` },
        { tag: recent },
      ])
    // 42501: permission denied.
    const refused = await deleteOldCacheInvalidations(web).catch(
      (error: unknown) => error,
    )
    expect(refused).toMatchObject({ cause: { code: '42501' } })
    expect(await deleteOldCacheInvalidations(worker)).toBeGreaterThanOrEqual(1)
    const left = await owner
      .select({ tag: cacheInvalidations.tag })
      .from(cacheInvalidations)
      .where(inArray(cacheInvalidations.tag, [old, recent]))
    expect(left.map((row) => row.tag)).toEqual([recent])
  })
})
