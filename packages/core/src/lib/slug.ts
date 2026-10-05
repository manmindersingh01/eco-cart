/*
 * The readable names used in web addresses, for example /sellers/green-basket.
 * A seller's slug never changes once given out, so links keep working. An
 * administrator may choose a new one for a category or brand, which moves its
 * page to a new address.
 */

const MAX_LENGTH = 60

/**
 * "Green Basket & Co." becomes "green-basket-and-co". A name with no Latin
 * letters or digits (for example one written only in Devanagari) falls back
 * to `fallback`.
 */
export function slugify(value: string, fallback: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replaceAll('&', ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_LENGTH)
    .replace(/-+$/, '')
  return slug || fallback
}

/**
 * The first free slug among `base`, `base-2`, `base-3`, ... given the slugs
 * already taken that start with `base`.
 */
export function firstFreeSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!used.has(candidate)) return candidate
  }
}
