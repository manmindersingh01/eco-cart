import type { ImageSize } from '../../lib/images.ts'
import type { Page } from '../../lib/pagination.ts'

/*
 * Types of the public storefront reads (backend spec step 9), kept apart from
 * types.ts, which the listing steps own.
 */

export const STOREFRONT_SORTS = ['newest', 'price_asc', 'price_desc'] as const
export type StorefrontSort = (typeof STOREFRONT_SORTS)[number]

/** Storefront lists show 24 products a page: grids of 2, 3, 4, or 6 columns. */
export const STOREFRONT_PAGE_SIZE = 24
export const MAX_BRAND_FILTERS = 10

/** A photo as visitors see it: ready, with all three sizes. */
export interface PublicImage {
  id: string
  alt: string
  /** Set when the photo shows one variant, for example the green one. */
  variantId: string | null
  width: number
  height: number
  urls: Record<ImageSize, string>
}

export interface CategoryLink {
  id: string
  name: string
  slug: string
}

/** A product in a storefront list. */
export interface ProductCard {
  id: string
  slug: string
  title: string
  brand: { name: string; slug: string } | null
  /** The lowest active variant price, which lists filter and sort by. */
  minPricePaise: number
  maxPricePaise: number
  minMrpPaise: number
  inStock: boolean
  ratingAvg: number
  ratingCount: number
  /** The fewest a buyer may order of any variant, for example 2. */
  minOrderQuantity: number
  /** The main photo. */
  image: PublicImage | null
}

export interface PublicVariant {
  id: string
  options: Record<string, string>
  pricePaise: number
  mrpPaise: number
  /** In stock for at least the product's minimum order quantity. */
  inStock: boolean
}

/** A product's video as visitors see it: converted, with its poster. */
export interface PublicVideo {
  /** The MP4 file. */
  url: string
  /** A still to show before it plays. */
  posterUrl: string
  width: number
  height: number
  durationMs: number
}

/** A product page. SKUs, stock counts, HSN codes, and GST rates stay private. */
export interface PublicProduct {
  id: string
  slug: string
  title: string
  description: string
  highlights: string[]
  attributes: Record<string, string>
  optionNames: string[]
  category: CategoryLink
  /** From the top level down to the product's own category. */
  breadcrumbs: CategoryLink[]
  brand: { id: string; name: string; slug: string } | null
  seller: { id: string; slug: string; displayName: string }
  /** Null while every variant is inactive. */
  minPricePaise: number | null
  maxPricePaise: number | null
  minMrpPaise: number | null
  /** At least one variant is in stock for the minimum order quantity. */
  inStock: boolean
  ratingAvg: number
  ratingCount: number
  /** The fewest a buyer may order of any variant, for example 2. */
  minOrderQuantity: number
  publishedAt: Date
  /** The active variants, in the seller's order. */
  variants: PublicVariant[]
  /**
   * The ready photos, in the seller's order: the first is the main photo,
   * which cards show, then up to three more.
   */
  images: PublicImage[]
  /** Null without a video, or until the worker has converted it. */
  video: PublicVideo | null
}

/** Filters of a storefront list, checked and with slugs turned into ids. */
export interface ProductFilters {
  /** Only these products, for example the ones a shopper asks about. */
  productIds?: string[]
  /** Only these categories; a category page passes its whole subtree. */
  categoryIds?: string[]
  brandIds?: string[]
  minPricePaise?: number
  maxPricePaise?: number
  /** Lists show only products in stock unless this is true. */
  includeOutOfStock?: boolean
}

/** A category page: the category, its place in the tree, and its products. */
export interface CategoryPage extends Page<ProductCard> {
  category: CategoryLink & {
    breadcrumbs: CategoryLink[]
    /** Its visible subcategories, in display order. */
    children: CategoryLink[]
  }
}

export interface HomeSection {
  /** `new_arrivals` first, then one `category` row per top-level category. */
  kind: 'new_arrivals' | 'category'
  category: CategoryLink | null
  products: ProductCard[]
}
