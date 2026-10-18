import { eq, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { PgBoss } from 'pg-boss'
import type { Database, Transaction } from '../../db/client.ts'
import { categories, products } from '../../db/schema/index.ts'
import {
  deleteOldCacheInvalidations,
  recordCacheInvalidations,
} from '../../lib/cache.ts'
import type { QueueDefinition } from '../../lib/queue.ts'

/*
 * Cache tags of the public storefront (backend spec step 9). The web app
 * tags each cached answer with what it shows; services call
 * invalidateStorefront in the transaction of every change that affects one,
 * which records the tags in the shared log (lib/cache.ts) so every web
 * container expires them. It works the same in the worker, which cannot
 * reach Next.js's cache itself.
 *
 * For example, when checkout sells the last Soft toothbrush, refreshProducts
 * records product:{id}, the tags of Bamboo Toothbrushes, Oral Care, and
 * Personal Care, and home, and the next visit to any of those pages shows it
 * out of stock.
 */

export const storefrontTags = {
  /** On every cached storefront answer. */
  catalogue: 'catalogue',
  home: 'home',
  product: (id: string) => `product:${id}`,
  /**
   * On a product page by its address, also when nothing is on sale there
   * yet, so approving the product at that address refreshes it.
   */
  productSlug: (slug: string) => `product-slug:${slug}`,
  /** On every list page of the category, which also lists everything below it. */
  category: (id: string) => `category:${id}`,
  /** On the pages of the seller's products, which show the seller's name. */
  seller: (id: string) => `seller:${id}`,
  /** A content page such as the returns policy (step 16). */
  content: (slug: string) => `content:${slug}`,
}

export type StorefrontChange =
  /** Price, stock, status, details, photos, or rating changed. */
  | { productIds: readonly string[] }
  /** The seller's display name changed. */
  | { sellerId: string }
  | { contentSlug: string }
  /** Categories or brands changed, or a seller was approved or suspended. */
  | 'everything'

/**
 * A change to more products than this at once, such as renaming a large
 * category, refreshes the whole storefront instead of recording a tag for
 * each, so the log every container reads stays short.
 */
export const MAX_PRODUCT_TAGS = 100

/** Records the tags of `change` in the caller's transaction. */
export async function invalidateStorefront(
  tx: Transaction,
  change: StorefrontChange,
): Promise<void> {
  await recordCacheInvalidations(tx, await tagsOf(tx, change))
}

const parent = alias(categories, 'parent')
const grandparent = alias(categories, 'grandparent')

async function tagsOf(
  tx: Transaction,
  change: StorefrontChange,
): Promise<string[]> {
  if (change === 'everything') return [storefrontTags.catalogue]
  if ('sellerId' in change) return [storefrontTags.seller(change.sellerId)]
  if ('contentSlug' in change) {
    return [storefrontTags.content(change.contentSlug)]
  }
  const ids = [...new Set(change.productIds)]
  if (ids.length === 0) return []
  if (ids.length > MAX_PRODUCT_TAGS) return [storefrontTags.catalogue]
  // The product's category and the two above it: the tree has three levels
  // at most (MAX_CATEGORY_DEPTH), so two joins reach the top.
  const rows = await tx
    .select({
      slug: products.slug,
      category: categories.id,
      parent: parent.id,
      grandparent: grandparent.id,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(parent, eq(parent.id, categories.parentId))
    .leftJoin(grandparent, eq(grandparent.id, parent.parentId))
    .where(inArray(products.id, ids))
  return [
    storefrontTags.home,
    ...ids.map(storefrontTags.product),
    ...rows.map((row) => storefrontTags.productSlug(row.slug)),
    ...rows.flatMap((row) =>
      [row.category, row.parent, row.grandparent]
        .filter((id) => id !== null)
        .map(storefrontTags.category),
    ),
  ]
}

/* The nightly clean-up of the shared log. */

export const CLEAR_CACHE_INVALIDATIONS_QUEUE =
  'catalogue.clear-cache-invalidations'

export const storefrontCacheQueues: QueueDefinition[] = [
  {
    name: CLEAR_CACHE_INVALIDATIONS_QUEUE,
    options: {
      retryLimit: 3,
      retryDelay: 60,
      retryBackoff: true,
      expireInSeconds: 300,
      deleteAfterSeconds: 7 * 24 * 60 * 60,
    },
  },
]

/**
 * Deletes invalidations older than a day, every night at 03:15 India time.
 * A night the worker was down gets one run when it starts again.
 */
export async function registerStorefrontCacheJobs(
  boss: PgBoss,
  deps: { db: Database },
): Promise<void> {
  await boss.schedule(CLEAR_CACHE_INVALIDATIONS_QUEUE, '15 3 * * *', null, {
    tz: 'Asia/Kolkata',
    missed: 'once',
  })
  await boss.work(CLEAR_CACHE_INVALIDATIONS_QUEUE, async () => {
    await deleteOldCacheInvalidations(deps.db)
  })
}
