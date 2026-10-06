import { z } from 'zod'
import {
  IMAGE_CONTENT_TYPES,
  MAX_UPLOAD_BYTES,
  type ImageSize,
} from '../../lib/images.ts'
import {
  gstRateBps,
  hsnCode,
  idOf,
  slug,
  strictObject,
  text,
  wholeNumber,
} from '../../lib/validation.ts'

const isActive = z.boolean({ error: 'must be true or false' })
const sortOrder = wholeNumber(0, 10_000)
const parentId = idOf('a category').nullable()

/** What an administrator sends to create a category. */
export const newCategory = strictObject({
  name: text(80),
  /** Null or left out: a top-level category. */
  parentId: parentId.optional(),
  gstRateBps,
  defaultHsnCode: hsnCode.nullable().optional(),
  sortOrder: sortOrder.optional(),
  /** Left out: made from the name. */
  slug: slug.optional(),
  isActive: isActive.optional(),
})
export type NewCategory = z.input<typeof newCategory>

/** The fields an administrator may change; a new parentId moves the category. */
export const categoryUpdate = strictObject({
  name: text(80).optional(),
  slug: slug.optional(),
  parentId: parentId.optional(),
  gstRateBps: gstRateBps.optional(),
  defaultHsnCode: hsnCode.nullable().optional(),
  sortOrder: sortOrder.optional(),
  isActive: isActive.optional(),
})

export interface CategoryView {
  id: string
  parentId: string | null
  name: string
  slug: string
  /** 0 for the top level, 1 and 2 below it. */
  depth: number
  gstRateBps: number
  defaultHsnCode: string | null
  sortOrder: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

/** A category with its subcategories, as administrators see the tree. */
export interface CategoryNode extends CategoryView {
  children: CategoryNode[]
}

/** A category in the public tree, which holds only visible categories. */
export interface PublicCategory {
  id: string
  name: string
  slug: string
  gstRateBps: number
  defaultHsnCode: string | null
  children: PublicCategory[]
}

/** What an administrator sends to create a brand. */
export const newBrand = strictObject({
  name: text(80),
  /** Left out: made from the name. */
  slug: slug.optional(),
  isActive: isActive.optional(),
})
export type NewBrand = z.input<typeof newBrand>

export const brandUpdate = strictObject({
  name: text(80).optional(),
  slug: slug.optional(),
  isActive: isActive.optional(),
})

export interface BrandView {
  id: string
  name: string
  slug: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

/** A brand in the public list, which holds only active brands. */
export interface PublicBrand {
  id: string
  name: string
  slug: string
}

export interface BrandListOptions {
  /** Only brands whose name contains this text, ignoring capital letters. */
  q?: string
  cursor?: string
  limit?: number
}

/* Products and variants (backend spec step 6). */

export const PRODUCT_STATUSES = [
  'draft',
  'pending_review',
  'approved',
  'rejected',
  'archived',
] as const
export type ProductStatus = (typeof PRODUCT_STATUSES)[number]

/** ₹10,00,000, a sanity limit that catches a price typed with extra zeros. */
export const MAX_PRICE_PAISE = 100_000_000
export const MAX_STOCK = 1_000_000
export const MAX_VARIANTS = 100
export const MAX_OPTION_NAMES = 3
export const MAX_HIGHLIGHTS = 8
export const MAX_ATTRIBUTES = 30

const sku = z
  .string({ error: 'must be text' })
  .trim()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/,
    'must be 1 to 64 letters, digits, dots, hyphens, underscores, or slashes, starting with a letter or digit',
  )
const price = wholeNumber(1, MAX_PRICE_PAISE)
const stock = wholeNumber(0, MAX_STOCK)
const title = z
  .string({ error: 'must be text' })
  .trim()
  .min(3, 'must be at least 3 characters')
  .max(150, 'must be at most 150 characters')
const description = z
  .string({ error: 'must be text' })
  .trim()
  .max(5000, 'must be at most 5000 characters')
const highlights = z
  .array(text(200), { error: 'must be a list of short texts' })
  .max(MAX_HIGHLIGHTS, `can have at most ${MAX_HIGHLIGHTS} items`)
const attributes = z
  .record(text(40), text(200), {
    error: 'must be an object of names and values',
  })
  .refine(
    (value) => Object.keys(value).length <= MAX_ATTRIBUTES,
    `can have at most ${MAX_ATTRIBUTES} entries`,
  )
const optionNames = z
  .array(text(30), { error: 'must be a list of names' })
  .max(MAX_OPTION_NAMES, `can have at most ${MAX_OPTION_NAMES} names`)
/** One value per option name, for example { "Size": "M" }. */
const optionValues = z.record(z.string(), text(50), {
  error: 'must be an object of option names and values',
})

export const newVariant = strictObject({
  sku,
  options: optionValues.optional(),
  pricePaise: price,
  mrpPaise: price,
  stock,
  isActive: isActive.optional(),
})
export type NewVariant = z.input<typeof newVariant>

export const newProduct = strictObject({
  categoryId: idOf('a category'),
  brandId: idOf('a brand').nullable().optional(),
  title,
  description: description.optional(),
  highlights: highlights.optional(),
  attributes: attributes.optional(),
  /** Left out: the category's default HSN code applies. */
  hsnCode: hsnCode.nullable().optional(),
  optionNames: optionNames.optional(),
  variants: z
    .array(newVariant, { error: 'must be a list of variants' })
    .min(1, 'must have at least one variant')
    .max(MAX_VARIANTS, `can have at most ${MAX_VARIANTS} variants`),
})
export type NewProduct = z.input<typeof newProduct>

/** Listing details; option names may be renamed, not added or removed. */
export const productUpdate = strictObject({
  categoryId: idOf('a category').optional(),
  brandId: idOf('a brand').nullable().optional(),
  title: title.optional(),
  description: description.optional(),
  highlights: highlights.optional(),
  attributes: attributes.optional(),
  hsnCode: hsnCode.nullable().optional(),
  optionNames: optionNames.optional(),
})

export const variantUpdate = strictObject({
  sku: sku.optional(),
  options: optionValues.optional(),
  pricePaise: price.optional(),
  mrpPaise: price.optional(),
  stock: stock.optional(),
  isActive: isActive.optional(),
})

export interface VariantView {
  id: string
  sku: string
  options: Record<string, string>
  pricePaise: number
  mrpPaise: number
  stock: number
  isActive: boolean
}

export type ImageStatus = 'processing' | 'ready' | 'failed'

export interface ImageView {
  id: string
  status: ImageStatus
  alt: string
  sortOrder: number
  variantId: string | null
  width: number | null
  height: number | null
  /** Why the photo cannot be used, when it failed. */
  failureReason: string | null
  /** Public addresses of each size, once the photo is ready. */
  urls: Record<ImageSize, string> | null
}

export interface ProductView {
  id: string
  slug: string
  status: ProductStatus
  title: string
  description: string
  highlights: string[]
  attributes: Record<string, string>
  optionNames: string[]
  /** The seller's own HSN code; null means the category's default applies. */
  hsnCode: string | null
  /** Set at approval (step 7); until then the category's rate applies. */
  gstRateBps: number | null
  category: {
    id: string
    name: string
    /** Names from the top level down, for breadcrumbs. */
    path: string[]
    gstRateBps: number
    defaultHsnCode: string | null
  }
  brand: { id: string; name: string } | null
  minPricePaise: number | null
  maxPricePaise: number | null
  minMrpPaise: number | null
  totalStock: number
  rejectionReason: string | null
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
  variants: VariantView[]
  images: ImageView[]
}

/** A product in the seller's list. */
export interface ProductSummary {
  id: string
  slug: string
  title: string
  status: ProductStatus
  categoryName: string
  minPricePaise: number | null
  maxPricePaise: number | null
  totalStock: number
  /** The main photo's thumbnail, once one is ready. */
  thumbnailUrl: string | null
  createdAt: Date
  updatedAt: Date
}

export interface ProductListOptions {
  status?: string
  cursor?: string
  limit?: number
}

/* Photos (backend spec step 6). */

export const imageUploadRequest = strictObject({
  contentType: z.enum(IMAGE_CONTENT_TYPES, {
    error: 'must be image/jpeg, image/png, image/webp, or image/avif',
  }),
  /** In bytes. */
  size: z
    .number({ error: 'must be a number' })
    .int('must be a whole number')
    .min(1, 'must be at least 1 byte')
    .max(MAX_UPLOAD_BYTES, 'must be at most 10 MB'),
})

export const newImage = strictObject({
  uploadKey: z.string({ error: 'must be text' }),
  alt: z
    .string({ error: 'must be text' })
    .trim()
    .max(200, 'must be at most 200 characters')
    .optional(),
  variantId: idOf('a variant').nullable().optional(),
})

export const imageUpdate = strictObject({
  alt: z
    .string({ error: 'must be text' })
    .trim()
    .max(200, 'must be at most 200 characters')
    .optional(),
  variantId: idOf('a variant').nullable().optional(),
})

export const imageOrder = strictObject({
  imageIds: z.array(idOf('a photo'), { error: 'must be a list of photo ids' }),
})

/** A signed form for one photo upload, straight to object storage. */
export interface ImageUpload {
  /** Pass back as `uploadKey` once the file is uploaded. */
  key: string
  url: string
  fields: Record<string, string>
  maxBytes: number
  expiresAt: Date
}
