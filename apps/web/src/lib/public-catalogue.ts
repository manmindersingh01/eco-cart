import { getCategoryTree, listBrands, withContext } from '@ecokart/core'
import { unstable_cache } from 'next/cache'
import { getDatabase } from './db'
import type { PublicBrand, PublicCategory } from './seller-products'

export const PUBLIC_CATEGORY_TAG = 'public-categories'
export const PUBLIC_BRAND_TAG = 'public-brands'

export type PublicBrandPage = {
  items: PublicBrand[]
  nextCursor: string | null
}

const loadPublicCategories = unstable_cache(
  () =>
    withContext(getDatabase(), { role: 'anonymous' }, (tx) =>
      getCategoryTree(tx),
    ),
  ['public-category-tree'],
  { revalidate: 3_600, tags: [PUBLIC_CATEGORY_TAG] },
)

const loadPublicBrands = unstable_cache(
  (q: string | undefined, cursor: string | undefined, limit: number) =>
    withContext(getDatabase(), { role: 'anonymous' }, (tx) =>
      listBrands(tx, {
        ...(q ? { q } : {}),
        ...(cursor ? { cursor } : {}),
        limit,
      }),
    ),
  ['public-brand-page'],
  { revalidate: 3_600, tags: [PUBLIC_BRAND_TAG] },
)

export function getPublicCategories(): Promise<PublicCategory[]> {
  return loadPublicCategories()
}

export function getPublicBrands({
  q,
  cursor,
  limit = 12,
}: {
  q?: string
  cursor?: string
  limit?: number
} = {}): Promise<PublicBrandPage> {
  return loadPublicBrands(q, cursor, limit)
}
