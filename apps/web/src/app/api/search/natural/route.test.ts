import { randomInt } from 'node:crypto'
import { createDatabase, createPool, requireEnv, schema } from '@ecokart/core'
import {
  createTestCategory,
  createTestProduct,
  createTestSeller,
  FAKE_AI_KEY,
  fakeChatReply,
  fakeDirection,
  fakeEmbeddingsReply,
  startFakeAiServer,
  type FakeAiServer,
} from '@ecokart/core/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { closePool } from '@/lib/db'
import { GET as search } from './route'

/*
 * Search by a sentence through the API (backend spec step 18), with the web
 * app's AI pointed at the fake server.
 */

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'natural-search-route-test',
)
const owner = createDatabase(ownerPool)

const word = (length = 10) =>
  Array.from({ length }, () => String.fromCharCode(97 + randomInt(26))).join('')

/** Each test searches from its own address, so the limit counts only its own. */
const searchRequest = (query: string) =>
  new Request(`http://localhost:3000/api/search/natural?${query}`, {
    headers: {
      'x-forwarded-for': `198.19.${randomInt(256)}.${randomInt(256)}`,
    },
  })

let fake: FakeAiServer
let categorySlug: string
const made: string[] = []
const AXIS = 700

beforeAll(async () => {
  fake = await startFakeAiServer()
  vi.stubEnv('AI_ENABLED', 'true')
  vi.stubEnv('AI_BASE_URL', fake.url)
  vi.stubEnv('AI_API_KEY', FAKE_AI_KEY)
  vi.stubEnv('AI_CHAT_MODEL', 'deepseek/deepseek-v4.1-flash')
  vi.stubEnv('AI_VISION_MODEL', 'deepseek/deepseek-v4.1-flash')
  vi.stubEnv('AI_EMBED_MODEL', 'voyageai/voyage-multimodal-3.5')
  vi.stubEnv('AI_EMBED_DIMENSIONS', '1024')

  const [{ seller }, category] = await Promise.all([
    createTestSeller(owner),
    createTestCategory(owner),
  ])
  categorySlug = category.slug
  for (const angle of [30, 10]) {
    const { product } = await createTestProduct(owner, {
      sellerId: seller.id,
      categoryId: category.id,
      publishedAt: new Date(),
    })
    await owner.insert(schema.productEmbeddings).values({
      productId: product.id,
      kind: 'text',
      model: 'test',
      contentHash: word(),
      embedding: fakeDirection(AXIS, angle),
    })
    made.push(product.id)
  }
})

afterAll(async () => {
  vi.unstubAllEnvs()
  await closePool()
  await Promise.all([ownerPool.end(), fake.close()])
})

describe('GET /api/search/natural', () => {
  test('answers the products nearest in meaning, and what the sentence was taken to mean', async () => {
    const words = `bamboo bottle ${word()}`
    fake.queue(
      fakeChatReply({
        query: words,
        category: '',
        brand: '',
        minPriceRupees: null,
        maxPriceRupees: 600,
      }),
      fakeEmbeddingsReply([fakeDirection(AXIS)]),
    )
    const response = await search(
      searchRequest(
        `q=${encodeURIComponent(`a bamboo bottle under 600 rupees ${word()}`)}&category=${categorySlug}`,
      ),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      match: 'meaning',
      nextCursor: null,
      understood: {
        query: words,
        category: null,
        brand: null,
        minPricePaise: null,
        maxPricePaise: 60_000,
      },
    })
    // The fixture's price is ₹500, inside the range; nearest first.
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(
      made.toReversed(),
    )
  })

  test('falls back to keywords when the model fails, and answers 400 for a request it cannot use', async () => {
    const term = word()
    await owner
      .update(schema.products)
      .set({ title: `${term} flask`, searchText: `${term} flask` })
      .where(eq(schema.products.id, made[0]!))
    fake.queue({ status: 502, body: { error: { message: 'Upstream error' } } })
    const response = await search(searchRequest(`q=${term}`))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ match: 'exact', understood: null })
    expect(body.items.map((item: { id: string }) => item.id)).toEqual([made[0]])

    const empty = await search(searchRequest('q='))
    expect(empty.status).toBe(400)
    expect(await empty.json()).toEqual({
      error: 'Those search details are not valid',
      issues: ['q must not be empty'],
    })
  })
})
