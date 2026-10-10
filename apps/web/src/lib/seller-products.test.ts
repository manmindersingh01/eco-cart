import { describe, expect, test } from 'vitest'
import {
  duplicateVariantIndexes,
  flattenLeafCategories,
  productListHref,
  serialiseProduct,
  type ProductFormValues,
  type PublicCategory,
} from './seller-products'

const categories: PublicCategory[] = [
  {
    id: 'home',
    name: 'Home',
    slug: 'home',
    gstRateBps: 1800,
    defaultHsnCode: null,
    children: [
      {
        id: 'home-storage',
        name: 'Storage',
        slug: 'storage',
        gstRateBps: 1800,
        defaultHsnCode: '3924',
        children: [],
      },
    ],
  },
  {
    id: 'office',
    name: 'Office',
    slug: 'office',
    gstRateBps: 1800,
    defaultHsnCode: null,
    children: [
      {
        id: 'office-storage',
        name: 'Storage',
        slug: 'storage-2',
        gstRateBps: 1800,
        defaultHsnCode: null,
        children: [],
      },
    ],
  },
]

const values: ProductFormValues = {
  categoryId: 'home-storage',
  brandId: '',
  title: 'Bamboo storage box',
  description: '',
  highlights: [],
  attributes: [],
  hsnCode: '',
  optionNames: [],
  variants: [
    {
      id: 'variant-1',
      sku: 'BOX-ONE',
      optionValues: [],
      priceRupees: '199.95',
      mrpRupees: '249',
      stock: '12',
      isActive: true,
    },
  ],
}

describe('seller product list helpers', () => {
  test('keeps the status and opaque cursor in the URL', () => {
    expect(productListHref('draft', 'opaque/+value=')).toBe(
      '/seller/products?status=draft&cursor=opaque%2F%2Bvalue%3D',
    )
  })

  test('returns only selectable leaves with disambiguating paths', () => {
    expect(
      flattenLeafCategories(categories).map((category) => category.path),
    ).toEqual([
      ['Home', 'Storage'],
      ['Office', 'Storage'],
    ])
  })
})

describe('draft product serialization', () => {
  test('converts rupees exactly to paise and sends a simple variant', () => {
    expect(serialiseProduct(values)).toEqual({
      ok: true,
      value: {
        categoryId: 'home-storage',
        brandId: null,
        title: 'Bamboo storage box',
        description: '',
        highlights: [],
        attributes: {},
        hsnCode: null,
        optionNames: [],
        variants: [
          {
            sku: 'BOX-ONE',
            options: {},
            pricePaise: 19_995,
            mrpPaise: 24_900,
            stock: 12,
            isActive: true,
          },
        ],
      },
    })
  })

  test('keeps option values in position when an option name changes', () => {
    const result = serialiseProduct({
      ...values,
      optionNames: [
        { id: 'option-1', value: 'Colour' },
        { id: 'option-2', value: 'Size' },
      ],
      variants: [
        {
          ...values.variants[0]!,
          optionValues: ['Green', 'Large'],
        },
      ],
    })
    expect(result).toMatchObject({
      ok: true,
      value: {
        variants: [{ options: { Colour: 'Green', Size: 'Large' } }],
      },
    })
  })

  test('finds duplicate option combinations ignoring case', () => {
    expect(
      duplicateVariantIndexes(
        ['Colour', 'Size'],
        [
          { ...values.variants[0]!, optionValues: ['Green', 'Large'] },
          {
            ...values.variants[0]!,
            id: 'variant-2',
            optionValues: [' green ', 'LARGE'],
          },
        ],
      ),
    ).toEqual([1])
  })

  test('keeps the backend MRP wording for local cross-field validation', () => {
    const result = serialiseProduct({
      ...values,
      variants: [
        {
          ...values.variants[0]!,
          priceRupees: '250',
          mrpRupees: '200',
        },
      ],
    })
    expect(result).toMatchObject({
      ok: false,
      issues: ['variants.0.mrpPaise must be at least pricePaise'],
    })
  })
})
