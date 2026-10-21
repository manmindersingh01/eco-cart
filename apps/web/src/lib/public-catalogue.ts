import {
  getCategoryTree,
  listBrands,
  storefrontTags,
  withContext,
} from '@ecokart/core'
import { cacheLife, cacheTag } from 'next/cache'
import { getDatabase } from './db'
import type { PublicBrand, PublicCategory } from './seller-products'

export type PublicBrandPage = {
  items: PublicBrand[]
  nextCursor: string | null
}

async function loadPublicCategories(): Promise<PublicCategory[]> {
  'use cache'
  cacheLife('storefront')
  cacheTag(storefrontTags.catalogue)
  return withContext(getDatabase(), { role: 'anonymous' }, (tx) =>
    getCategoryTree(tx),
  )
}

async function loadPublicBrands(
  q: string | undefined,
  cursor: string | undefined,
  limit: number,
): Promise<PublicBrandPage> {
  'use cache'
  cacheLife('storefront')
  cacheTag(storefrontTags.catalogue)
  return withContext(getDatabase(), { role: 'anonymous' }, (tx) =>
    listBrands(tx, {
      ...(q ? { q } : {}),
      ...(cursor ? { cursor } : {}),
      limit,
    }),
  )
}

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
