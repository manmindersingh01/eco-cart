import {
  createDatabase,
  createPool,
  NotFoundError,
  requireEnv,
  ValidationError,
} from '@ecokart/core'
import {
  createTestCategory,
  createTestProduct,
  createTestSeller,
} from '@ecokart/core/testing'
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { closePool } from './db'
import { readCategoryPage, readProductPage } from './storefront'

/*
 * The tags each cached storefront answer carries (backend spec step 9).
 * Outside Next.js 'use cache' does nothing, so these record what cacheTag
 * was given; the caching itself is checked end to end on a production build.
 */

const tags = vi.hoisted(() => [] as string[])
vi.mock('next/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/cache')>()),
  cacheLife: () => {},
  cacheTag: (...given: string[]) => {
    tags.push(...given)
  },
}))

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'storefront-reader-test',
)
const owner = createDatabase(ownerPool)

beforeEach(() => {
  tags.length = 0
})

afterAll(async () => {
  await closePool()
  await ownerPool.end()
})

describe('product pages', () => {
  test('a product on sale is tagged with its id, seller, and address', async () => {
    const [{ seller }, category] = await Promise.all([
      createTestSeller(owner),
      createTestCategory(owner),
    ])
    const { product } = await createTestProduct(owner, {
      sellerId: seller.id,
      categoryId: category.id,
    })
    await readProductPage(product.slug)
    expect(tags.toSorted()).toEqual(
      [
        'catalogue',
        `product:${product.id}`,
        `product-slug:${product.slug}`,
        `seller:${seller.id}`,
      ].toSorted(),
    )
  })

  test('an address with nothing on sale is a 404 tagged with the address, so an approval there refreshes it', async () => {
    const [{ seller }, category] = await Promise.all([
      createTestSeller(owner),
      createTestCategory(owner),
    ])
    const { product } = await createTestProduct(owner, {
      sellerId: seller.id,
      categoryId: category.id,
      status: 'pending_review',
    })
    await expect(readProductPage(product.slug)).rejects.toThrow(NotFoundError)
    expect(tags.toSorted()).toEqual(
      ['catalogue', `product-slug:${product.slug}`].toSorted(),
    )
  })

  test('an address longer than any product address gets no address tag', async () => {
    const long = 'a'.repeat(300)
    await expect(readProductPage(long)).rejects.toThrow(NotFoundError)
    expect(tags).toEqual(['catalogue'])
  })
})

describe('category pages', () => {
  test('filters that are not valid are a 400 with every issue', async () => {
    const category = await createTestCategory(owner)
    const error = await readCategoryPage(category.slug, {
      sort: 'cheapest',
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ValidationError)
    expect(error).toMatchObject({
      message: 'Those filters are not valid',
      issues: ['sort must be one of newest, price_asc, price_desc'],
    })
    expect(tags).toEqual(['catalogue'])
  })

  test('a category found is tagged with its id', async () => {
    const category = await createTestCategory(owner)
    await readCategoryPage(category.slug, {})
    expect(tags.toSorted()).toEqual(
      ['catalogue', `category:${category.id}`].toSorted(),
    )
  })
})
