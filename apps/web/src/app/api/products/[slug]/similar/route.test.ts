import { randomUUID } from 'node:crypto'
import { createDatabase, createPool, requireEnv, schema } from '@ecokart/core'
import {
  createTestCategory,
  createTestProduct,
  createTestSeller,
  fakeDirection,
} from '@ecokart/core/testing'
import { afterAll, describe, expect, test } from 'vitest'
import { closePool } from '@/lib/db'
import { GET } from './route'

/* Similar products on a product page (backend spec step 18). */

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'similar-route-test',
)
const owner = createDatabase(ownerPool)

afterAll(async () => {
  await closePool()
  await ownerPool.end()
})

const similar = (slug: string) =>
  GET(new Request(`http://localhost:3000/api/products/${slug}/similar`), {
    params: Promise.resolve({ slug }),
  })

describe('GET /api/products/{slug}/similar', () => {
  test('lists products like this one, nearest first, and 404 for a product not on sale', async () => {
    const [{ seller }, category] = await Promise.all([
      createTestSeller(owner),
      createTestCategory(owner),
    ])
    const ids: string[] = []
    let subjectSlug = ''
    for (const angle of [0, 25, 10]) {
      const { product } = await createTestProduct(owner, {
        sellerId: seller.id,
        categoryId: category.id,
        publishedAt: new Date(),
      })
      await owner.insert(schema.productEmbeddings).values({
        productId: product.id,
        kind: 'text',
        model: 'test',
        contentHash: randomUUID(),
        embedding: fakeDirection(800, angle),
      })
      if (angle === 0) subjectSlug = product.slug
      else ids.push(product.id)
    }

    const response = await similar(subjectSlug)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(
      ids.toReversed(),
    )

    expect((await similar('no-such-product-here')).status).toBe(404)
  })
})
