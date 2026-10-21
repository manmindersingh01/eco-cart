/*
 * Display and address helpers for the buyer storefront pages. They run in
 * the browser too, so they do not import @ecokart/core.
 */

const wholeRupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

const rupeesAndPaise = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** A price for shoppers: ₹1,00,000 for whole rupees, ₹199.50 otherwise. */
export function formatPrice(paise: number): string {
  return paise % 100 === 0
    ? wholeRupees.format(paise / 100)
    : rupeesAndPaise.format(paise / 100)
}

/** The whole-number percentage off the MRP, or null when there is none. */
export function discountPercent(
  pricePaise: number,
  mrpPaise: number,
): number | null {
  if (mrpPaise <= pricePaise || mrpPaise <= 0) return null
  const percent = Math.floor(((mrpPaise - pricePaise) * 100) / mrpPaise)
  return percent > 0 ? percent : null
}

/** The rating as one decimal, for example 4.5. */
export const formatRating = (rating: number): string =>
  (Math.round(rating * 10) / 10).toFixed(1)

/** The query keys a storefront list keeps in its address. */
export const LISTING_KEYS = [
  'q',
  'brand',
  'minPricePaise',
  'maxPricePaise',
  'includeOutOfStock',
  'sort',
  'cursor',
  // Not in the controls, but kept so a shared address keeps its page size.
  'limit',
] as const
export type ListingKey = (typeof LISTING_KEYS)[number]
export type ListingQuery = Partial<Record<ListingKey, string>>

export type SortOption = { value: string; label: string }

/**
 * The sorts of every storefront list. They live here, not beside the
 * controls, because a server page cannot read a value from a client module.
 */
export const LIST_SORTS: readonly SortOption[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
]

/**
 * The list keys from a page's search parameters, one value each and no
 * empty ones, in the shape the storefront reads take.
 */
export function listingQuery(
  searchParams: Record<string, string | string[] | undefined>,
): ListingQuery {
  const query: ListingQuery = {}
  for (const key of LISTING_KEYS) {
    const raw = searchParams[key]
    const value = Array.isArray(raw) ? raw.at(-1) : raw
    if (value !== undefined && value.trim() !== '') query[key] = value.trim()
  }
  return query
}

/**
 * The address of a list with some keys changed. Changing anything but the
 * cursor starts again at the first page, because a cursor only continues
 * the list it came from.
 */
export function listingHref<Path extends `/${string}`>(
  path: Path,
  query: ListingQuery,
  changes: ListingQuery,
): Path | `${Path}?${string}` {
  const next: ListingQuery = { ...query, ...changes }
  if (!('cursor' in changes)) delete next.cursor
  const params = new URLSearchParams()
  for (const key of LISTING_KEYS) {
    const value = next[key]
    if (value) params.set(key, value)
  }
  const encoded = params.toString()
  return encoded ? `${path}?${encoded}` : path
}

/** The query as the storefront reads take it, without unset keys. */
export function queryRecord(query: ListingQuery): Record<string, string> {
  return Object.fromEntries(
    Object.entries(query).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
}
