import {
  MAX_MIN_ORDER_QUANTITY,
  MAX_PRICE_PAISE,
  MAX_STOCK,
  type NewProduct,
} from '../catalogue/types.ts'
import { IMPORT_FIELD_INFO, type ImportField } from './types.ts'

/*
 * Turns one spreadsheet row into the input `createProduct` takes (backend
 * step 8), so an imported product passes exactly the same checks as one
 * made by hand. This file only reads text; it never touches the database.
 */

export interface ImportLookups {
  /** Every category, with the names on its path from the top level down. */
  categories: readonly { id: string; path: readonly string[] }[]
  /** Every brand, by its name in lower case. */
  brandIds: ReadonlyMap<string, string>
}

export type NormalizedRow =
  | { ok: true; sku: string; product: NewProduct }
  | { ok: false; issues: string[] }

const rupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})
const count = new Intl.NumberFormat('en-IN')
const sameText = (a: string, b: string) =>
  a.localeCompare(b, 'en-IN', { sensitivity: 'base' }) === 0

/** Each mapped field's column heading. */
const columnsOf = (mapping: Readonly<Record<string, ImportField>>) =>
  new Map(
    Object.entries(mapping).map(([column, field]) => [field, column] as const),
  )

/**
 * Rupees as typed in a spreadsheet, such as "1299", "1,299.50", or
 * "₹ 1,00,000", in paise. Null when it is not an amount. Only whole numbers
 * are used, so the value is exact.
 */
export function parseRupees(text: string): number | null {
  const plain = text.replace(/^(₹|rs\.?|inr)/i, '').replaceAll(/\s/g, '')
  const match = /^(\d{1,3}(?:,\d{2,3})*|\d+)(?:\.(\d{1,2}))?$/.exec(plain)
  if (!match) return null
  const whole = match[1]!.replaceAll(',', '')
  if (whole.length > 12) return null
  return Number(whole) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
}

/** A whole number such as "25", "1,000", or "25.0" from a workbook. */
export function parseWholeNumber(text: string): number | null {
  const match = /^(\d{1,3}(?:,\d{2,3})*|\d+)(?:\.0+)?$/.exec(text.trim())
  if (!match) return null
  const digits = match[1]!.replaceAll(',', '')
  return digits.length > 12 ? null : Number(digits)
}

function findCategory(
  lookups: ImportLookups,
  text: string,
): { id: string } | { problem: string } {
  const wanted = text.split('>').map((part) => part.trim())
  const matches =
    wanted.length > 1
      ? lookups.categories.filter(
          (category) =>
            category.path.length === wanted.length &&
            category.path.every((name, index) =>
              sameText(name, wanted[index]!),
            ),
        )
      : lookups.categories.filter((category) =>
          sameText(category.path.at(-1)!, wanted[0]!),
        )
  if (matches.length === 1) return { id: matches[0]!.id }
  if (matches.length === 0) {
    return { problem: `"${text}" is not an EcoKart category` }
  }
  return {
    problem: `"${text}" matches more than one category; write its full path, such as ${matches[0]!.path.join(' > ')}`,
  }
}

/**
 * Checks one row and builds the product it describes. `mapping` takes the
 * file's column headings to fields; the messages name the seller's own
 * headings, because those are what they see in their file.
 */
export function normalizeRow(
  raw: Readonly<Record<string, string>>,
  mapping: Readonly<Record<string, ImportField>>,
  lookups: ImportLookups,
): NormalizedRow {
  const columns = columnsOf(mapping)
  const issues: string[] = []
  const value = (field: ImportField) => {
    const column = columns.get(field)
    return column === undefined ? '' : (raw[column] ?? '').trim()
  }
  const name = (field: ImportField) => `"${columns.get(field)}"`

  for (const { field, required } of IMPORT_FIELD_INFO) {
    if (required && value(field) === '') issues.push(`${name(field)} is empty`)
  }

  const amount = (field: 'price' | 'mrp') => {
    const text = value(field)
    if (text === '') return 0
    const paise = parseRupees(text)
    if (paise === null) {
      issues.push(
        `${name(field)} must be an amount in rupees, such as 1299 or 1,299.50`,
      )
    } else if (paise < 1) {
      issues.push(`${name(field)} must be more than ₹0`)
    } else if (paise > MAX_PRICE_PAISE) {
      issues.push(
        `${name(field)} must be at most ${rupees.format(MAX_PRICE_PAISE / 100)}`,
      )
    }
    return paise ?? 0
  }
  const wholeNumber = (field: ImportField, min: number, max: number) => {
    const text = value(field)
    if (text === '') return undefined
    const number = parseWholeNumber(text)
    if (number === null) {
      issues.push(`${name(field)} must be a whole number, such as 25`)
    } else if (number < min || number > max) {
      issues.push(
        `${name(field)} must be from ${count.format(min)} to ${count.format(max)}`,
      )
    }
    return number ?? undefined
  }

  const pricePaise = amount('price')
  const mrpPaise = amount('mrp')
  const stock = wholeNumber('stock', 0, MAX_STOCK)
  const minOrderQuantity = wholeNumber(
    'minOrderQuantity',
    1,
    MAX_MIN_ORDER_QUANTITY,
  )

  let categoryId = ''
  if (value('category') !== '') {
    const found = findCategory(lookups, value('category'))
    if ('id' in found) categoryId = found.id
    else issues.push(`${name('category')} ${found.problem}`)
  }
  let brandId: string | undefined
  if (value('brand') !== '') {
    brandId = lookups.brandIds.get(value('brand').toLowerCase())
    if (!brandId) {
      issues.push(
        `${name('brand')} "${value('brand')}" is not an EcoKart brand; leave it empty, or ask EcoKart to add it`,
      )
    }
  }

  if (issues.length > 0) return { ok: false, issues }
  const highlights = value('highlights')
    .split(/\s*\|\s*|\s*\n\s*/)
    .filter(Boolean)
  return {
    ok: true,
    sku: value('sku'),
    product: {
      categoryId,
      ...(brandId ? { brandId } : {}),
      title: value('title'),
      ...(value('description') ? { description: value('description') } : {}),
      ...(highlights.length > 0 ? { highlights } : {}),
      ...(value('hsnCode') ? { hsnCode: value('hsnCode') } : {}),
      ...(minOrderQuantity === undefined ? {} : { minOrderQuantity }),
      variants: [
        { sku: value('sku'), pricePaise, mrpPaise, stock: stock ?? 0 },
      ],
    },
  }
}

// Where createProduct's messages point, and the field each one comes from.
const PRODUCT_PATHS: [string, ImportField][] = [
  ['variants.0.pricePaise', 'price'],
  ['variants.0.mrpPaise', 'mrp'],
  ['variants.0.stock', 'stock'],
  ['variants.0.sku', 'sku'],
  ['minOrderQuantity', 'minOrderQuantity'],
  ['description', 'description'],
  ['highlights', 'highlights'],
  ['categoryId', 'category'],
  ['brandId', 'brand'],
  ['hsnCode', 'hsnCode'],
  ['title', 'title'],
]

/**
 * Rewrites createProduct's messages, such as "variants.0.mrpPaise must be at
 * least pricePaise", with the seller's column headings: "MRP" must be at
 * least "Price".
 */
export function describeProductIssues(
  issues: readonly string[],
  mapping: Readonly<Record<string, ImportField>>,
): string[] {
  const columns = columnsOf(mapping)
  const heading = (field: ImportField) =>
    columns.has(field) ? `"${columns.get(field)}"` : field
  return issues.map((issue) => {
    let text = issue
    for (const [path, field] of PRODUCT_PATHS) {
      const item = new RegExp(`^${path.replaceAll('.', '\\.')}\\.(\\d+) `).exec(
        text,
      )
      if (item) {
        text = `${heading(field)} point ${Number(item[1]) + 1} ${text.slice(item[0].length)}`
        break
      }
      if (text.startsWith(`${path} `)) {
        text = `${heading(field)} ${text.slice(path.length + 1)}`
        break
      }
    }
    return text.replaceAll('pricePaise', heading('price'))
  })
}
