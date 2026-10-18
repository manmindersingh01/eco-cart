import { describe, expect, test } from 'vitest'
import {
  describeProductIssues,
  normalizeRow,
  parseRupees,
  parseWholeNumber,
  type ImportLookups,
} from './rows.ts'
import type { ImportField } from './types.ts'

describe('parseRupees', () => {
  test('reads amounts the way sellers type them, in exact paise', () => {
    expect(
      [
        '1299',
        '1,299.50',
        '₹ 1,00,000',
        'Rs. 49.9',
        'rs 50',
        'INR 100,000.00',
        '0.05',
        '19.99',
      ].map(parseRupees),
    ).toEqual([129_900, 129_950, 10_000_000, 4990, 5000, 10_000_000, 5, 1999])
  })

  test('refuses what is not an amount', () => {
    expect(
      [
        '',
        'free',
        '12.345',
        '1,2',
        ',100',
        '100,',
        '1.',
        '.5',
        '-5',
        '1e3',
        '₹',
      ].map(parseRupees),
    ).toEqual(Array.from({ length: 11 }, () => null))
  })
})

describe('parseWholeNumber', () => {
  test('reads whole numbers, with commas or a workbook .0', () => {
    expect(['25', '1,000', '25.0', '0'].map(parseWholeNumber)).toEqual([
      25, 1000, 25, 0,
    ])
    expect(['2.5', '-1', 'ten', ''].map(parseWholeNumber)).toEqual([
      null,
      null,
      null,
      null,
    ])
  })
})

const lookups: ImportLookups = {
  categories: [
    { id: 'home', path: ['Home & Kitchen'] },
    { id: 'kitchen', path: ['Home & Kitchen', 'Kitchen & Dining'] },
    {
      id: 'bamboo-kitchen',
      path: ['Home & Kitchen', 'Kitchen & Dining', 'Bamboo'],
    },
    { id: 'care', path: ['Personal Care'] },
    { id: 'bamboo-care', path: ['Personal Care', 'Bamboo'] },
    { id: 'soaps', path: ['Personal Care', 'Handmade Soaps'] },
  ],
  brandIds: new Map([['bamboo home', 'brand-1']]),
}

const mapping: Record<string, ImportField> = {
  'Product Name': 'title',
  Category: 'category',
  'Item Code': 'sku',
  'Price (Rs)': 'price',
  MRP: 'mrp',
  Qty: 'stock',
  About: 'description',
  'Key points': 'highlights',
  Brand: 'brand',
  HSN: 'hsnCode',
  'Min qty': 'minOrderQuantity',
}

const soap = (changes: Record<string, string> = {}) => ({
  'Product Name': 'Neem and Tulsi Soap, 100 g',
  Category: 'Handmade Soaps',
  'Item Code': 'NTS-100',
  'Price (Rs)': '₹149',
  MRP: '199.00',
  Qty: '1,200',
  About: '',
  'Key points': '',
  Brand: '',
  HSN: '',
  'Min qty': '',
  ...changes,
})

describe('normalizeRow', () => {
  test('builds the product a row describes', () => {
    expect(
      normalizeRow(
        soap({
          About: 'Cold-pressed with neem oil.',
          'Key points': 'Neem | Tulsi\nNo palm oil',
          Brand: 'BAMBOO HOME',
          HSN: '3401',
          'Min qty': '3',
        }),
        mapping,
        lookups,
      ),
    ).toEqual({
      ok: true,
      sku: 'NTS-100',
      product: {
        categoryId: 'soaps',
        brandId: 'brand-1',
        title: 'Neem and Tulsi Soap, 100 g',
        description: 'Cold-pressed with neem oil.',
        highlights: ['Neem', 'Tulsi', 'No palm oil'],
        hsnCode: '3401',
        minOrderQuantity: 3,
        variants: [
          { sku: 'NTS-100', pricePaise: 14_900, mrpPaise: 19_900, stock: 1200 },
        ],
      },
    })
  })

  test('leaves out the optional fields a row leaves empty or a file has no column for', () => {
    const fewer: Record<string, ImportField> = {
      'Product Name': 'title',
      Category: 'category',
      'Item Code': 'sku',
      'Price (Rs)': 'price',
      MRP: 'mrp',
      Qty: 'stock',
    }
    expect(normalizeRow(soap(), fewer, lookups)).toEqual({
      ok: true,
      sku: 'NTS-100',
      product: {
        categoryId: 'soaps',
        title: 'Neem and Tulsi Soap, 100 g',
        variants: [
          { sku: 'NTS-100', pricePaise: 14_900, mrpPaise: 19_900, stock: 1200 },
        ],
      },
    })
  })

  test('finds a category by its full path when its name is not unique', () => {
    const byPath = normalizeRow(
      soap({ Category: 'home & kitchen > Kitchen & Dining > bamboo' }),
      mapping,
      lookups,
    )
    expect(byPath.ok && byPath.product.categoryId).toBe('bamboo-kitchen')
    expect(
      normalizeRow(soap({ Category: 'Bamboo' }), mapping, lookups),
    ).toEqual({
      ok: false,
      issues: [
        '"Category" "Bamboo" matches more than one category; write its full path, such as Home & Kitchen > Kitchen & Dining > Bamboo',
      ],
    })
  })

  test("lists every problem in the seller's own column names", () => {
    expect(
      normalizeRow(
        soap({
          'Product Name': '',
          Category: 'Garden',
          'Price (Rs)': 'free',
          MRP: '20,00,000',
          Qty: '2.5',
          Brand: 'Unknown Co',
          'Min qty': '0',
        }),
        mapping,
        lookups,
      ),
    ).toEqual({
      ok: false,
      issues: [
        '"Product Name" is empty',
        '"Price (Rs)" must be an amount in rupees, such as 1299 or 1,299.50',
        '"MRP" must be at most ₹10,00,000',
        '"Qty" must be a whole number, such as 25',
        '"Min qty" must be from 1 to 1,000',
        '"Category" "Garden" is not an EcoKart category',
        '"Brand" "Unknown Co" is not an EcoKart brand; leave it empty, or ask EcoKart to add it',
      ],
    })
    expect(
      normalizeRow(soap({ 'Price (Rs)': '0', Qty: '' }), mapping, lookups),
    ).toEqual({
      ok: false,
      issues: ['"Qty" is empty', '"Price (Rs)" must be more than ₹0'],
    })
  })
})

describe('describeProductIssues', () => {
  test("rewrites a product's problems with the seller's column names", () => {
    expect(
      describeProductIssues(
        [
          'title must be at least 3 characters',
          'variants.0.mrpPaise must be at least pricePaise',
          'highlights.2 must be at most 200 characters',
          'categoryId has subcategories; choose the most specific one',
          'hsnCode must have 4, 6, or 8 digits',
          'something else entirely',
        ],
        mapping,
      ),
    ).toEqual([
      '"Product Name" must be at least 3 characters',
      '"MRP" must be at least "Price (Rs)"',
      '"Key points" point 3 must be at most 200 characters',
      '"Category" has subcategories; choose the most specific one',
      '"HSN" must have 4, 6, or 8 digits',
      'something else entirely',
    ])
  })
})
