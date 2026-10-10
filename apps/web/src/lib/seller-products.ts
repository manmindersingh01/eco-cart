import { parseRupeesToPaise, parseWholeNumber } from './admin-settings'

export const PRODUCT_STATUSES = [
  'draft',
  'pending_review',
  'approved',
  'rejected',
  'archived',
] as const

export type ProductStatus = (typeof PRODUCT_STATUSES)[number]

export type ProductSummary = {
  id: string
  slug: string
  title: string
  status: ProductStatus
  categoryName: string
  minPricePaise: number | null
  maxPricePaise: number | null
  totalStock: number
  thumbnailUrl: string | null
  createdAt: string
  updatedAt: string
}

export type PublicCategory = {
  id: string
  name: string
  slug: string
  gstRateBps: number
  defaultHsnCode: string | null
  children: PublicCategory[]
}

export type LeafCategory = Omit<PublicCategory, 'children'> & {
  path: string[]
}

export type PublicBrand = {
  id: string
  name: string
  slug: string
}

export type AttributeFormValue = {
  id: string
  name: string
  value: string
}

export type VariantFormValue = {
  id: string
  sku: string
  optionValues: string[]
  priceRupees: string
  mrpRupees: string
  stock: string
  isActive: boolean
}

export type ProductFormValues = {
  categoryId: string
  brandId: string
  title: string
  description: string
  highlights: Array<{ id: string; value: string }>
  attributes: AttributeFormValue[]
  hsnCode: string
  optionNames: Array<{ id: string; value: string }>
  variants: VariantFormValue[]
}

export type ProductInput = {
  categoryId: string
  brandId: string | null
  title: string
  description: string
  highlights: string[]
  attributes: Record<string, string>
  hsnCode: string | null
  optionNames: string[]
  variants: Array<{
    sku: string
    options: Record<string, string>
    pricePaise: number
    mrpPaise: number
    stock: number
    isActive: boolean
  }>
}

export type ProductSerialiseResult =
  | { ok: true; value: ProductInput }
  | { ok: false; error: string; issues: string[] }

export function isProductStatus(value: unknown): value is ProductStatus {
  return PRODUCT_STATUSES.some((status) => status === value)
}

export function productListHref(
  status?: ProductStatus,
  cursor?: string,
): '/seller/products' | `/seller/products?${string}` {
  const query = new URLSearchParams()
  if (status) query.set('status', status)
  if (cursor) query.set('cursor', cursor)
  const encoded = query.toString()
  return encoded ? `/seller/products?${encoded}` : '/seller/products'
}

export function flattenLeafCategories(
  categories: readonly PublicCategory[],
  parentPath: readonly string[] = [],
): LeafCategory[] {
  return categories.flatMap((category) => {
    const path = [...parentPath, category.name]
    if (category.children.length === 0) {
      const { children: _children, ...leaf } = category
      return [{ ...leaf, path }]
    }
    return flattenLeafCategories(category.children, path)
  })
}

export function mapOptionValues(
  optionNames: readonly string[],
  optionValues: readonly string[],
): Record<string, string> {
  return Object.fromEntries(
    optionNames.map((name, index) => [name, optionValues[index] ?? '']),
  )
}

export function duplicateVariantIndexes(
  optionNames: readonly string[],
  variants: readonly VariantFormValue[],
): number[] {
  if (optionNames.length === 0) return variants.length > 1 ? [1] : []
  const seen = new Map<string, number>()
  const duplicates: number[] = []
  variants.forEach((variant, index) => {
    const combination = variant.optionValues
      .slice(0, optionNames.length)
      .map((value) => value.trim().toLocaleLowerCase('en-IN'))
      .join('\u0000')
    if (seen.has(combination)) duplicates.push(index)
    else seen.set(combination, index)
  })
  return duplicates
}

function duplicateIndexes(values: readonly string[]): number[] {
  const seen = new Set<string>()
  const duplicates: number[] = []
  values.forEach((value, index) => {
    const normalised = value.trim().toLocaleLowerCase('en-IN')
    if (seen.has(normalised)) duplicates.push(index)
    else seen.add(normalised)
  })
  return duplicates
}

export function serialiseProduct(
  values: ProductFormValues,
): ProductSerialiseResult {
  const issues: string[] = []
  const title = values.title.trim()
  if (!values.categoryId) issues.push('categoryId is required')
  if (title.length < 3) issues.push('title must be at least 3 characters')
  if (title.length > 150) issues.push('title must be at most 150 characters')
  if (values.description.trim().length > 5000)
    issues.push('description must be at most 5000 characters')
  if (values.highlights.length > 8)
    issues.push('highlights can have at most 8 items')
  if (values.attributes.length > 30)
    issues.push('attributes can have at most 30 entries')
  if (values.optionNames.length > 3)
    issues.push('optionNames can have at most 3 names')
  if (values.variants.length < 1)
    issues.push('variants must have at least one variant')
  if (values.variants.length > 100)
    issues.push('variants can have at most 100 variants')

  const highlights = values.highlights.map(({ value }, index) => {
    const trimmed = value.trim()
    if (!trimmed) issues.push(`highlights.${index} must not be empty`)
    if (trimmed.length > 200)
      issues.push(`highlights.${index} must be at most 200 characters`)
    return trimmed
  })

  const attributes: Record<string, string> = {}
  const attributeNames = values.attributes.map(({ name }) => name)
  for (const index of duplicateIndexes(attributeNames)) {
    issues.push(`attributes.${index}.name is already used`)
  }
  values.attributes.forEach((attribute, index) => {
    const name = attribute.name.trim()
    const value = attribute.value.trim()
    if (!name) issues.push(`attributes.${index}.name must not be empty`)
    if (name.length > 40)
      issues.push(`attributes.${index}.name must be at most 40 characters`)
    if (!value) issues.push(`attributes.${index}.value must not be empty`)
    if (value.length > 200)
      issues.push(`attributes.${index}.value must be at most 200 characters`)
    if (name) attributes[name] = value
  })

  const optionNames = values.optionNames.map(({ value }) => value.trim())
  optionNames.forEach((name, index) => {
    if (!name) issues.push(`optionNames.${index} must not be empty`)
    if (name.length > 30)
      issues.push(`optionNames.${index} must be at most 30 characters`)
  })
  for (const index of duplicateIndexes(optionNames)) {
    issues.push(`optionNames.${index} is already used ignoring capital letters`)
  }
  if (optionNames.length === 0 && values.variants.length > 1) {
    issues.push(
      'variants must have exactly one entry when there are no option names',
    )
  }

  for (const index of duplicateVariantIndexes(optionNames, values.variants)) {
    issues.push(`variants.${index}.options are the same as another variant's`)
  }

  const variants = values.variants.map((variant, index) => {
    const price = parseRupeesToPaise(variant.priceRupees)
    const mrp = parseRupeesToPaise(variant.mrpRupees)
    const stock = parseWholeNumber(variant.stock, 'Stock')
    const sku = variant.sku.trim()
    if (!sku) issues.push(`variants.${index}.sku must not be empty`)
    if (sku.length > 64)
      issues.push(`variants.${index}.sku must be at most 64 characters`)
    optionNames.forEach((name, optionIndex) => {
      const value = variant.optionValues[optionIndex]?.trim() ?? ''
      if (!value)
        issues.push(`variants.${index}.options needs a value for ${name}`)
      if (value.length > 50)
        issues.push(
          `variants.${index}.options.${name} must be at most 50 characters`,
        )
    })
    if (!price.ok) issues.push(`variants.${index}.pricePaise ${price.error}`)
    if (!mrp.ok) issues.push(`variants.${index}.mrpPaise ${mrp.error}`)
    if (!stock.ok) issues.push(`variants.${index}.stock ${stock.error}`)
    if (price.ok && (price.value < 1 || price.value > 100_000_000))
      issues.push(`variants.${index}.pricePaise must be from 1 to 100000000`)
    if (mrp.ok && (mrp.value < 1 || mrp.value > 100_000_000))
      issues.push(`variants.${index}.mrpPaise must be from 1 to 100000000`)
    if (stock.ok && stock.value > 1_000_000)
      issues.push(`variants.${index}.stock must be at most 1000000`)
    if (price.ok && mrp.ok && mrp.value < price.value)
      issues.push(`variants.${index}.mrpPaise must be at least pricePaise`)
    return {
      sku,
      options: mapOptionValues(optionNames, variant.optionValues),
      pricePaise: price.ok ? price.value : 0,
      mrpPaise: mrp.ok ? mrp.value : 0,
      stock: stock.ok ? stock.value : 0,
      isActive: variant.isActive,
    }
  })

  if (issues.length > 0) {
    return {
      ok: false,
      error: 'Check the product details below.',
      issues,
    }
  }
  return {
    ok: true,
    value: {
      categoryId: values.categoryId,
      brandId: values.brandId || null,
      title,
      description: values.description.trim(),
      highlights,
      attributes,
      hsnCode: values.hsnCode.trim() || null,
      optionNames,
      variants,
    },
  }
}
