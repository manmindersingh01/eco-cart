import {
  parseRupeesToPaise,
  parseWholeNumber,
  paiseToRupeeInput,
} from './admin-settings'
import type { ProductStatus } from './seller-products'

export type ProductVariant = {
  id: string
  sku: string
  options: Record<string, string>
  pricePaise: number
  mrpPaise: number
  stock: number
  isActive: boolean
}

export type ProductImage = {
  id: string
  status: 'processing' | 'ready' | 'failed'
  alt: string
  sortOrder: number
  variantId: string | null
  width: number | null
  height: number | null
  failureReason: string | null
  urls: { thumb: string; card: string; gallery: string } | null
}

export type SellerProduct = {
  id: string
  slug: string
  status: ProductStatus
  title: string
  description: string
  highlights: string[]
  attributes: Record<string, string>
  optionNames: string[]
  hsnCode: string | null
  gstRateBps: number | null
  category: {
    id: string
    name: string
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
  publishedAt: string | null
  createdAt: string
  updatedAt: string
  variants: ProductVariant[]
  images: ProductImage[]
}

export type ListingFormValues = {
  categoryId: string
  brandId: string
  title: string
  description: string
  highlights: string[]
  attributes: Array<{ name: string; value: string }>
  hsnCode: string
  optionNames: string[]
}

export type VariantEditValues = {
  sku: string
  optionValues: string[]
  priceRupees: string
  mrpRupees: string
  stock: string
  isActive: boolean
}

type Result<T> =
  { ok: true; value: T } | { ok: false; error: string; issues: string[] }

export function canEditListing(status: ProductStatus): boolean {
  return status === 'draft' || status === 'rejected'
}

export function listingValues(product: SellerProduct): ListingFormValues {
  return {
    categoryId: product.category.id,
    brandId: product.brand?.id ?? '',
    title: product.title,
    description: product.description,
    highlights: [...product.highlights],
    attributes: Object.entries(product.attributes).map(([name, value]) => ({
      name,
      value,
    })),
    hsnCode: product.hsnCode ?? '',
    optionNames: [...product.optionNames],
  }
}

export function serialiseListingChanges(
  initial: ListingFormValues,
  current: ListingFormValues,
): Result<Record<string, unknown> | null> {
  const issues: string[] = []
  const title = current.title.trim()
  const description = current.description.trim()
  const highlights = current.highlights.map((value) => value.trim())
  const optionNames = current.optionNames.map((value) => value.trim())
  const attributes = Object.fromEntries(
    current.attributes.map(({ name, value }) => [name.trim(), value.trim()]),
  )
  if (title.length < 3) issues.push('title must be at least 3 characters')
  if (title.length > 150) issues.push('title must be at most 150 characters')
  if (description.length > 5000)
    issues.push('description must be at most 5000 characters')
  highlights.forEach((value, index) => {
    if (!value) issues.push(`highlights.${index} must not be empty`)
    if (value.length > 200)
      issues.push(`highlights.${index} must be at most 200 characters`)
  })
  current.attributes.forEach(({ name, value }, index) => {
    if (!name.trim()) issues.push(`attributes.${index}.name must not be empty`)
    if (!value.trim())
      issues.push(`attributes.${index}.value must not be empty`)
  })
  optionNames.forEach((value, index) => {
    if (!value) issues.push(`optionNames.${index} must not be empty`)
  })
  const normalisedOptions = optionNames.map((value) => value.toLowerCase())
  if (new Set(normalisedOptions).size !== normalisedOptions.length) {
    issues.push('optionNames must not repeat ignoring capital letters')
  }
  if (issues.length > 0) {
    return { ok: false, error: 'Check the listing details below.', issues }
  }

  const changes: Record<string, unknown> = {}
  if (current.categoryId !== initial.categoryId)
    changes.categoryId = current.categoryId
  if (current.brandId !== initial.brandId)
    changes.brandId = current.brandId || null
  if (title !== initial.title) changes.title = title
  if (description !== initial.description) changes.description = description
  if (JSON.stringify(highlights) !== JSON.stringify(initial.highlights))
    changes.highlights = highlights
  if (
    JSON.stringify(attributes) !==
    JSON.stringify(
      Object.fromEntries(
        initial.attributes.map(({ name, value }) => [name, value]),
      ),
    )
  ) {
    changes.attributes = attributes
  }
  if ((current.hsnCode.trim() || '') !== initial.hsnCode)
    changes.hsnCode = current.hsnCode.trim() || null
  if (JSON.stringify(optionNames) !== JSON.stringify(initial.optionNames))
    changes.optionNames = optionNames
  return { ok: true, value: Object.keys(changes).length ? changes : null }
}

export function variantValues(
  variant: ProductVariant,
  optionNames: readonly string[],
): VariantEditValues {
  return {
    sku: variant.sku,
    optionValues: optionNames.map((name) => variant.options[name] ?? ''),
    priceRupees: paiseToRupeeInput(variant.pricePaise),
    mrpRupees: paiseToRupeeInput(variant.mrpPaise),
    stock: String(variant.stock),
    isActive: variant.isActive,
  }
}

export function serialiseVariantChanges(
  initial: VariantEditValues,
  current: VariantEditValues,
  optionNames: readonly string[],
  identityEditable: boolean,
): Result<Record<string, unknown> | null> {
  const issues: string[] = []
  const price = parseRupeesToPaise(current.priceRupees)
  const mrp = parseRupeesToPaise(current.mrpRupees)
  const stock = parseWholeNumber(current.stock, 'Stock')
  if (!price.ok) issues.push(`pricePaise ${price.error}`)
  if (!mrp.ok) issues.push(`mrpPaise ${mrp.error}`)
  if (!stock.ok) issues.push(`stock ${stock.error}`)
  if (price.ok && (price.value < 1 || price.value > 100_000_000))
    issues.push('pricePaise must be from 1 to 100000000')
  if (mrp.ok && (mrp.value < 1 || mrp.value > 100_000_000))
    issues.push('mrpPaise must be from 1 to 100000000')
  if (stock.ok && stock.value > 1_000_000)
    issues.push('stock must be at most 1000000')
  if (price.ok && mrp.ok && mrp.value < price.value)
    issues.push('mrpPaise must be at least pricePaise')
  if (identityEditable) {
    if (!current.sku.trim()) issues.push('sku must not be empty')
    optionNames.forEach((name, index) => {
      if (!current.optionValues[index]?.trim())
        issues.push(`options needs a value for ${name}`)
    })
  }
  if (issues.length > 0)
    return { ok: false, error: 'Check this variant below.', issues }

  const changes: Record<string, unknown> = {}
  if (identityEditable && current.sku.trim() !== initial.sku)
    changes.sku = current.sku.trim()
  if (
    identityEditable &&
    JSON.stringify(current.optionValues) !==
      JSON.stringify(initial.optionValues)
  ) {
    changes.options = Object.fromEntries(
      optionNames.map((name, index) => [
        name,
        current.optionValues[index]?.trim() ?? '',
      ]),
    )
  }
  if (price.ok && current.priceRupees !== initial.priceRupees)
    changes.pricePaise = price.value
  if (mrp.ok && current.mrpRupees !== initial.mrpRupees)
    changes.mrpPaise = mrp.value
  if (stock.ok && current.stock !== initial.stock) changes.stock = stock.value
  if (current.isActive !== initial.isActive) changes.isActive = current.isActive
  return { ok: true, value: Object.keys(changes).length ? changes : null }
}

export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export function validateImageFile(
  file: Pick<File, 'type' | 'size'>,
): string | null {
  if (!ALLOWED_IMAGE_TYPES.some((type) => type === file.type)) {
    return 'Use a JPEG, PNG, WebP, or AVIF image.'
  }
  if (file.size < 1) return 'The image file is empty.'
  if (file.size > MAX_IMAGE_BYTES) return 'The image must be 10 MB or smaller.'
  return null
}

export function signedUploadBody(
  fields: Readonly<Record<string, string>>,
  file: File | Blob,
): FormData {
  const body = new FormData()
  for (const [name, value] of Object.entries(fields)) body.append(name, value)
  body.append('file', file)
  return body
}

export function shouldPollImages(
  images: readonly ProductImage[],
  visible: boolean,
): boolean {
  return visible && images.some((image) => image.status === 'processing')
}

export function nextPollDelay(attempt: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attempt), 5_000)
}

export function movedImageIds(
  images: readonly Pick<ProductImage, 'id'>[],
  index: number,
  direction: -1 | 1,
): string[] {
  const ids = images.map((image) => image.id)
  const destination = index + direction
  if (
    index < 0 ||
    index >= ids.length ||
    destination < 0 ||
    destination >= ids.length
  )
    return ids
  const [moving] = ids.splice(index, 1)
  ids.splice(destination, 0, moving!)
  return ids
}
