import {
  getCategoryPage,
  getHomePage,
  getPublicProduct,
  storefrontTags,
  withContext,
  type CategoryPage,
  type HomeSection,
  type PublicProduct,
} from '@ecokart/core'
import { cacheLife, cacheTag } from 'next/cache'
import { getDatabase } from './db'
import { getStorage } from './storage'

/*
 * The public storefront reads (backend spec step 9), cached by Next.js and
 * shared by the public API routes and the server-rendered storefront pages.
 * They run as the anonymous context, so an answer never depends on who
 * asked. Each answer is tagged with what it shows; services record changed
 * tags (invalidateStorefront in @ecokart/core), and src/cache-handler.ts
 * expires them in every web container.
 *
 * A page that is not found throws, and Next.js does not cache a thrown
 * error, so a product approved a moment ago is found at once.
 */

export async function readProductPage(slug: string): Promise<PublicProduct> {
  'use cache'
  cacheLife('storefront')
  cacheTag(storefrontTags.catalogue)
  const product = await withContext(
    getDatabase(),
    { role: 'anonymous' },
    (tx) => getPublicProduct(tx, getStorage(), slug),
  )
  cacheTag(
    storefrontTags.product(product.id),
    storefrontTags.seller(product.seller.id),
  )
  return product
}

/** `query` is the request's query string, for example `{ sort: 'price_asc' }`. */
export async function readCategoryPage(
  slug: string,
  query: Record<string, string>,
): Promise<CategoryPage> {
  'use cache'
  cacheLife('storefront')
  cacheTag(storefrontTags.catalogue)
  const page = await withContext(getDatabase(), { role: 'anonymous' }, (tx) =>
    getCategoryPage(tx, getStorage(), slug, query),
  )
  // Changes record the tags of a product's category and every one above it.
  cacheTag(storefrontTags.category(page.category.id))
  return page
}

export async function readHomePage(): Promise<HomeSection[]> {
  'use cache'
  cacheLife('storefront')
  cacheTag(storefrontTags.catalogue, storefrontTags.home)
  return withContext(getDatabase(), { role: 'anonymous' }, (tx) =>
    getHomePage(tx, getStorage()),
  )
}
