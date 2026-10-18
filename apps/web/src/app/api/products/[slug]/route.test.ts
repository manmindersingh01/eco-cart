import { createDatabase, createPool, requireEnv, schema } from '@ecokart/core'
import {
  createTestBrand,
  createTestCategory,
  createTestProduct,
  createTestSeller,
} from '@ecokart/core/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { closePool } from '@/lib/db'
import { apiRequest as request } from '@/testing/requests'
import { GET as categoryProducts } from '../../categories/[slug]/products/route'
import { GET as home } from '../../home/route'
import { GET as product } from './route'

/*
 * The public storefront routes (backend spec step 9), called the way Next.js
 * calls them for a browser. The services are tested in packages/core; these
 * prove each route's answers.
 */

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'storefront-route-test',
)
const owner = createDatabase(ownerPool)

let categorySlug: string
let made: Awaited<ReturnType<typeof createTestProduct>>
let brandSlug: string

beforeAll(async () => {
  const [{ seller }, category, brand] = await Promise.all([
    createTestSeller(owner),
    createTestCategory(owner),
    createTestBrand(owner),
  ])
  categorySlug = category.slug
  brandSlug = brand.slug
  made = await createTestProduct(owner, {
    sellerId: seller.id,
    categoryId: category.id,
    brandId: brand.id,
    publishedAt: new Date(),
  })
  await createTestProduct(owner, {
    sellerId: seller.id,
    categoryId: category.id,
    publishedAt: new Date(),
  })
})

afterAll(async () => {
  await closePool()
  await ownerPool.end()
})

const slugParams = (slug: string) => ({ params: Promise.resolve({ slug }) })

describe('GET /api/products/{slug}', () => {
  test('answers the product page to anyone', async () => {
    const response = await product(
      request(`/products/${made.product.slug}`),
      slugParams(made.product.slug),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.product).toMatchObject({
      id: made.product.id,
      slug: made.product.slug,
      title: made.product.title,
      brand: { slug: brandSlug },
      category: { slug: categorySlug },
      variants: [{ id: made.variant.id, pricePaise: 50_000, inStock: true }],
    })
    expect(typeof body.product.publishedAt).toBe('string')
  })

  test('answers 404 for a product that is not on sale', async () => {
    await owner
      .update(schema.products)
      .set({ status: 'archived' })
      .where(eq(schema.products.id, made.product.id))
    try {
      const response = await product(
        request(`/products/${made.product.slug}`),
        slugParams(made.product.slug),
      )
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({
        error: 'There is no product at that address',
      })
    } finally {
      await owner
        .update(schema.products)
        .set({ status: 'approved' })
        .where(eq(schema.products.id, made.product.id))
    }
  })
})

describe('GET /api/categories/{slug}/products', () => {
  test('answers the category and a page of its products', async () => {
    const response = await categoryProducts(
      request(`/categories/${categorySlug}/products?sort=price_asc&limit=1`),
      slugParams(categorySlug),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.category).toMatchObject({ slug: categorySlug, children: [] })
    expect(body.items).toHaveLength(1)
    expect(typeof body.nextCursor).toBe('string')

    const next = await categoryProducts(
      request(
        `/categories/${categorySlug}/products?sort=price_asc&limit=1&cursor=${body.nextCursor}`,
      ),
      slugParams(categorySlug),
    )
    const nextBody = await next.json()
    expect(nextBody.items).toHaveLength(1)
    expect(nextBody.items[0].id).not.toBe(body.items[0].id)
    expect(nextBody.nextCursor).toBeNull()
  })

  test('filters by brand from the query string', async () => {
    const response = await categoryProducts(
      request(`/categories/${categorySlug}/products?brand=${brandSlug}`),
      slugParams(categorySlug),
    )
    const body = await response.json()
    expect(body.items.map((item: { id: string }) => item.id)).toEqual([
      made.product.id,
    ])
  })

  test('answers 400 for filters it cannot use and 404 for an unknown category', async () => {
    const invalid = await categoryProducts(
      request(`/categories/${categorySlug}/products?sort=cheapest&colour=red`),
      slugParams(categorySlug),
    )
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toEqual({
      error: 'Those filters are not valid',
      issues: [
        'sort must be one of newest, price_asc, price_desc',
        'colour is not allowed here',
      ],
    })
    const missing = await categoryProducts(
      request('/categories/no-such-category/products'),
      slugParams('no-such-category'),
    )
    expect(missing.status).toBe(404)
  })
})

describe('GET /api/home', () => {
  test('answers the home page sections', async () => {
    const response = await home()
    expect(response.status).toBe(200)
    const { sections } = await response.json()
    expect(sections[0]).toMatchObject({ kind: 'new_arrivals', category: null })
    const row = sections.find(
      (section: { category: { slug: string } | null }) =>
        section.category?.slug === categorySlug,
    )
    expect(row.products.map((item: { id: string }) => item.id)).toContain(
      made.product.id,
    )
  })
})
