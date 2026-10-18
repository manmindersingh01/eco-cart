import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Transaction } from '../../db/client.ts'
import type { RequestContext } from '../../db/context.ts'
import { searchQueries } from '../../db/schema/index.ts'
import {
  ForbiddenError,
  TooManyRequestsError,
  ValidationError,
} from '../../errors.ts'
import { cursorOrder } from '../../lib/pagination.ts'
import {
  parseInput,
  slug as slugFormat,
  strictObject,
} from '../../lib/validation.ts'
import { loadCategoryTree } from '../catalogue/categories.ts'
import type { PhotoAddresses } from '../catalogue/products.ts'
import {
  listingFilters,
  listingParameters,
  listPublicProducts,
  wholeNumberText,
  type WordMatch,
} from '../catalogue/storefront.ts'
import { STOREFRONT_SORTS } from '../catalogue/storefront-types.ts'
import { consumeRateLimit, hashedRateLimitKey } from '../rate-limits/service.ts'
import type { SearchGap, SearchResult } from './types.ts'

/*
 * Keyword search (backend spec step 9, design doc 6.8). This module turns a
 * request into filters, chooses between full-text and similar-word matching,
 * logs each search for the gap report, and limits searches per address. The
 * products themselves come from the catalogue's one product list, so if
 * search ever moves to a dedicated engine (design doc 9) only this module
 * changes. Step 18 adds natural-language and image search on top.
 */

const INVALID = 'Those search details are not valid'

/** Shorter queries have too few letter triples for similar-word matching. */
export const MIN_SIMILAR_LENGTH = 3

/**
 * 120 searches a minute per address: generous, because many Indian mobile
 * users share one address through their carrier, while still stopping a
 * script from scraping the catalogue.
 */
export const SEARCH_LIMIT = { limit: 120, windowSeconds: 60 }

const searchParameters = strictObject({
  q: z
    .string()
    .transform((value) => value.trim().replace(/\s+/g, ' '))
    .pipe(
      z
        .string()
        .min(1, 'must not be empty')
        .max(100, 'must be at most 100 characters'),
    ),
  category: slugFormat.optional(),
  ...listingParameters,
  sort: z.enum([...STOREFRONT_SORTS, 'relevance']).optional(),
})

/**
 * Counts one search against the visitor's address, or refuses it with 429.
 * Run it in a transaction of its own, so the count's row lock is released at
 * once instead of holding every search from a shared address in a queue.
 */
export async function consumeSearchAllowance(
  tx: Transaction,
  clientAddress: string | null,
  now: Date = new Date(),
): Promise<void> {
  const result = await consumeRateLimit(
    tx,
    {
      // A missing address shares one count, so it can never bypass the limit.
      key: hashedRateLimitKey('search:ip', clientAddress ?? 'unknown'),
      ...SEARCH_LIMIT,
    },
    now,
  )
  if (!result.allowed) {
    throw new TooManyRequestsError(
      'Too many searches from your address; please wait a moment and try again',
      { resetAt: result.resetAt },
    )
  }
}

/**
 * One page of keyword results. `query` is the request's query string: `q`
 * plus the storefront list parameters, `category`, and `sort` (relevance by
 * default). When the words match nothing, similar words are tried, for
 * typos; the answer's `match` says which kind it is, and its cursor
 * continues the same kind.
 *
 * A new search (no cursor) is logged for the gap report; later pages are not.
 * Run it as the anonymous context: the log is anonymous by design.
 */
export async function searchProducts(
  tx: Transaction,
  photos: PhotoAddresses,
  query: Record<string, string>,
): Promise<SearchResult> {
  const started = performance.now()
  const parameters = parseInput(searchParameters, query, INVALID)
  const tree = await loadCategoryTree(tx)

  let categoryIds: string[] | undefined
  if (parameters.category) {
    const category = tree.bySlug(parameters.category)
    if (!category || !tree.isVisible(category.id)) {
      throw new ValidationError(INVALID, [
        `category ${parameters.category} is not a category on sale`,
      ])
    }
    categoryIds = tree.subtreeIds(category.id)
  }
  const filters = {
    ...(await listingFilters(tx, parameters)),
    ...(categoryIds ? { categoryIds } : {}),
  }
  const { q, cursor, limit } = parameters
  const sort = parameters.sort ?? 'relevance'
  const page = (match: WordMatch) =>
    listPublicProducts(
      tx,
      photos,
      {
        filters,
        match,
        sort,
        ...(cursor ? { cursor } : {}),
        ...(limit ? { limit } : {}),
      },
      tree,
    )

  // A later page continues the kind of match its first page used.
  let kind: WordMatch['kind'] =
    cursor && cursorOrder(cursor).startsWith('similar-') ? 'similar' : 'exact'
  let result = await page({ kind, text: q })
  if (
    !cursor &&
    kind === 'exact' &&
    result.items.length === 0 &&
    q.length >= MIN_SIMILAR_LENGTH
  ) {
    const similar = await page({ kind: 'similar', text: q })
    // Reported only when it found something, so an empty answer never
    // claims to show similar words.
    if (similar.items.length > 0) {
      kind = 'similar'
      result = similar
    }
  }

  if (!cursor) {
    // No RETURNING: visitors may add log rows but not read them.
    await tx.insert(searchQueries).values({
      kind: 'keyword',
      queryText: q,
      resultCount: result.items.length,
      latencyMs: Math.round(performance.now() - started),
    })
  }
  return { ...result, match: kind }
}

const gapParameters = strictObject({
  days: wholeNumberText(1, 90).optional(),
})

/** The gap report shows at most this many queries. */
export const MAX_GAPS = 100

/**
 * The catalogue gap report (design doc 6.8): the searches that found
 * nothing in the last `days` days (default 30), grouped ignoring capital
 * letters, most frequent first. A fixed-size report, so it has a limit
 * rather than pages. Administrators only.
 */
export async function listSearchGaps(
  tx: Transaction,
  context: RequestContext,
  query: Record<string, string> = {},
): Promise<SearchGap[]> {
  if (context.role !== 'admin' && context.role !== 'system') {
    throw new ForbiddenError('Only administrators can see the gap report')
  }
  const { days = 30 } = parseInput(
    gapParameters,
    query,
    'Those report details are not valid',
  )
  const text = sql<string>`lower(${searchQueries.queryText})`
  const searches = sql<number>`count(*)::int`
  const last = sql<Date>`max(${searchQueries.createdAt})`
  const rows = await tx
    .select({ query: text, searches, lastSearchedAt: last })
    .from(searchQueries)
    .where(
      and(
        eq(searchQueries.resultCount, 0),
        isNotNull(searchQueries.queryText),
        gte(
          searchQueries.createdAt,
          sql`now() - make_interval(days => ${days})`,
        ),
      ),
    )
    .groupBy(text)
    .orderBy(desc(searches), desc(last), text)
    .limit(MAX_GAPS)
  return rows.map((row) => ({
    query: row.query,
    searches: row.searches,
    // Aggregates come back as text; the column itself is timestamptz.
    lastSearchedAt: new Date(row.lastSearchedAt),
  }))
}
