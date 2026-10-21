import { describe, expect, test } from 'vitest'
import { brandListUrl, countCategories, mergeBrands } from './public-home'
import type { PublicBrand, PublicCategory } from './seller-products'

const brand = (id: string, name = id): PublicBrand => ({
  id,
  name,
  slug: name.toLowerCase(),
})

describe('public catalogue presentation', () => {
  test('builds a bounded brand URL and keeps the cursor opaque', () => {
    expect(brandListUrl('  green home  ', 'next+/=', 8)).toBe(
      '/api/brands?limit=8&q=green+home&cursor=next%2B%2F%3D',
    )
  })

  test('omits empty search and cursor values', () => {
    expect(brandListUrl('   ')).toBe('/api/brands?limit=12')
  })

  test('adds later pages without repeating a brand', () => {
    expect(
      mergeBrands(
        [brand('one'), brand('two')],
        [brand('two', 'Updated'), brand('three')],
      ),
    ).toEqual([brand('one'), brand('two', 'Updated'), brand('three')])
  })

  test('counts the complete visible category hierarchy', () => {
    const categories: PublicCategory[] = [
      {
        id: 'home',
        name: 'Home',
        slug: 'home',
        gstRateBps: 1800,
        defaultHsnCode: null,
        children: [
          {
            id: 'kitchen',
            name: 'Kitchen',
            slug: 'kitchen',
            gstRateBps: 1800,
            defaultHsnCode: null,
            children: [],
          },
        ],
      },
    ]
    expect(countCategories(categories)).toBe(2)
  })
})
