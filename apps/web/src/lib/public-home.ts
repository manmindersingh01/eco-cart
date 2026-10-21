import type { PublicBrand, PublicCategory } from './seller-products'

export function brandListUrl(
  query: string,
  cursor?: string | null,
  limit = 12,
): `/api/brands?${string}` {
  const params = new URLSearchParams({ limit: String(limit) })
  const normalisedQuery = query.trim()
  if (normalisedQuery) params.set('q', normalisedQuery)
  if (cursor) params.set('cursor', cursor)
  return `/api/brands?${params.toString()}`
}

export function mergeBrands(
  current: readonly PublicBrand[],
  incoming: readonly PublicBrand[],
): PublicBrand[] {
  const brands = new Map(current.map((brand) => [brand.id, brand]))
  for (const brand of incoming) brands.set(brand.id, brand)
  return [...brands.values()]
}

export function countCategories(categories: readonly PublicCategory[]): number {
  return categories.reduce(
    (total, category) => total + 1 + countCategories(category.children),
    0,
  )
}
