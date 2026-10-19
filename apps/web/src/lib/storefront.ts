import {
  CONTENT_SLUGS,
  getCategoryPage,
  getHomePage,
  getPublicCompanyDetails,
  getPublicProduct,
  getPublishedContentPage,
  listProductReviews,
  NotConfiguredError,
  NotFoundError,
  storefrontTags,
  ValidationError,
  withContext,
  type CategoryPage,
  type HomeSection,
  type Page,
  type PublicCompanyDetails,
  type PublicContentPage,
  type PublicProduct,
  type PublicReview,
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
 * A page that is not found, a query that is not valid, or a setting not
 * configured yet is cached as an answer too, never thrown: Next.js passes an error thrown inside 'use cache'
 * on without its class, and in production without its message, so the route
 * could not tell a 404 from a crash. The exported functions throw it again,
 * outside the cache, as the error handleErrors expects.
 */

type Answer<T> =
  | { kind: 'found'; value: T }
  | { kind: 'not_found'; message: string }
  | { kind: 'invalid'; message: string; issues: string[] }
  | { kind: 'not_configured'; message: string }

async function answer<T>(read: () => Promise<T>): Promise<Answer<T>> {
  try {
    return { kind: 'found', value: await read() }
  } catch (error) {
    if (error instanceof NotFoundError) {
      return { kind: 'not_found', message: error.message }
    }
    if (error instanceof ValidationError) {
      return { kind: 'invalid', message: error.message, issues: error.issues }
    }
    if (error instanceof NotConfiguredError) {
      return { kind: 'not_configured', message: error.message }
    }
    throw error
  }
}

function found<T>(page: Answer<T>): T {
  if (page.kind === 'found') return page.value
  if (page.kind === 'not_found') throw new NotFoundError(page.message)
  if (page.kind === 'not_configured') throw new NotConfiguredError(page.message)
  throw new ValidationError(page.message, page.issues)
}

async function cachedProductPage(slug: string): Promise<Answer<PublicProduct>> {
  'use cache'
  cacheLife('storefront')
  cacheTag(storefrontTags.catalogue)
  const page = await answer(() =>
    withContext(getDatabase(), { role: 'anonymous' }, (tx) =>
      getPublicProduct(tx, getStorage(), slug),
    ),
  )
  if (page.kind === 'found') {
    cacheTag(
      storefrontTags.product(page.value.id),
      storefrontTags.seller(page.value.seller.id),
    )
  }
  // Product addresses have at most 100 characters, well inside Next.js's
  // limit of 256 for a tag; a longer one is never on sale.
  if (slug.length <= 100) cacheTag(storefrontTags.productSlug(slug))
  return page
}

export async function readProductPage(slug: string): Promise<PublicProduct> {
  return found(await cachedProductPage(slug))
}

async function cachedCategoryPage(
  slug: string,
  query: Record<string, string>,
): Promise<Answer<CategoryPage>> {
  'use cache'
  cacheLife('storefront')
  // A category that is not found yet appears through a change to the tree,
  // which refreshes the whole catalogue.
  cacheTag(storefrontTags.catalogue)
  const page = await answer(() =>
    withContext(getDatabase(), { role: 'anonymous' }, (tx) =>
      getCategoryPage(tx, getStorage(), slug, query),
    ),
  )
  if (page.kind === 'found') {
    // Changes record the tags of a product's category and every one above it.
    cacheTag(storefrontTags.category(page.value.category.id))
  }
  return page
}

/** `query` is the request's query string, for example `{ sort: 'price_asc' }`. */
export async function readCategoryPage(
  slug: string,
  query: Record<string, string>,
): Promise<CategoryPage> {
  return found(await cachedCategoryPage(slug, query))
}

export async function readHomePage(): Promise<HomeSection[]> {
  'use cache'
  cacheLife('storefront')
  cacheTag(storefrontTags.catalogue, storefrontTags.home)
  return withContext(getDatabase(), { role: 'anonymous' }, (tx) =>
    getHomePage(tx, getStorage()),
  )
}

async function cachedProductReviews(
  slug: string,
  query: Record<string, string>,
): Promise<Answer<Page<PublicReview>>> {
  'use cache'
  cacheLife('storefront')
  cacheTag(storefrontTags.catalogue)
  // Every review change records the product's tags, its address among them.
  if (slug.length <= 100) cacheTag(storefrontTags.productSlug(slug))
  return answer(() =>
    withContext(getDatabase(), { role: 'anonymous' }, (tx) =>
      listProductReviews(tx, slug, query),
    ),
  )
}

/** `query` is the request's query string: `cursor` and `limit`. */
export async function readProductReviews(
  slug: string,
  query: Record<string, string>,
): Promise<Page<PublicReview>> {
  return found(await cachedProductReviews(slug, query))
}

async function cachedContentPage(
  slug: string,
): Promise<Answer<PublicContentPage>> {
  'use cache'
  cacheLife('storefront')
  cacheTag(storefrontTags.catalogue)
  if (CONTENT_SLUGS.some((page) => page === slug)) {
    cacheTag(storefrontTags.content(slug))
  }
  return answer(() =>
    withContext(getDatabase(), { role: 'anonymous' }, (tx) =>
      getPublishedContentPage(tx, slug),
    ),
  )
}

export async function readContentPage(
  slug: string,
): Promise<PublicContentPage> {
  return found(await cachedContentPage(slug))
}

async function cachedCompanyDetails(): Promise<Answer<PublicCompanyDetails>> {
  'use cache'
  cacheLife('storefront')
  cacheTag(storefrontTags.catalogue, storefrontTags.company)
  return answer(() =>
    withContext(getDatabase(), { role: 'anonymous' }, (tx) =>
      getPublicCompanyDetails(tx),
    ),
  )
}

/** The storefront footer's company details; 503 until they are saved. */
export async function readCompanyDetails(): Promise<PublicCompanyDetails> {
  return found(await cachedCompanyDetails())
}
