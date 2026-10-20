import { randomInt, randomUUID } from 'node:crypto'
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
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { closePool } from '@/lib/db'
import { POST as ask } from './route'

/*
 * The shopping assistant through the API (backend spec step 20), with the
 * web app's AI pointed at the fake server.
 */

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'assistant-route-test',
)
const owner = createDatabase(ownerPool)
const AXIS = 900

let fake: FakeAiServer
let productId: string

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
  const { product } = await createTestProduct(owner, {
    sellerId: seller.id,
    categoryId: category.id,
    publishedAt: new Date(),
  })
  productId = product.id
  await owner.insert(schema.productEmbeddings).values({
    productId,
    kind: 'text',
    model: 'test',
    contentHash: randomUUID(),
    embedding: fakeDirection(AXIS, 5),
  })
})

afterAll(async () => {
  vi.unstubAllEnvs()
  await closePool()
  await Promise.all([ownerPool.end(), fake.close()])
})

/** Each test asks from its own address, so the limit counts only its own. */
const question = (body: unknown) =>
  ask(
    new Request('http://localhost:3000/api/assistant', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': `198.21.${randomInt(256)}.${randomInt(256)}`,
      },
      body: JSON.stringify(body),
    }),
  )

const answerBody = z.strictObject({
  answer: z.string(),
  declined: z.boolean(),
  products: z.array(z.object({ id: z.string() }).loose()),
  comparison: z.unknown(),
})

describe('POST /api/assistant', () => {
  test('answers with the products it names as cards', async () => {
    fake.queue(
      fakeEmbeddingsReply([fakeDirection(AXIS)]),
      fakeChatReply({
        answer: 'The Bamboo bottle is a good choice.',
        productIds: [productId],
        comparison: null,
        declined: false,
      }),
    )
    const response = await question({
      question: `Which bottle should I buy? ${randomUUID()}`,
    })
    expect(response.status).toBe(200)
    const body = answerBody.parse(await response.json())
    expect(body).toMatchObject({
      answer: 'The Bamboo bottle is a good choice.',
      declined: false,
      comparison: null,
    })
    expect(body.products.map((card) => card.id)).toEqual([productId])
  })

  test('answers 400 for a question it cannot take', async () => {
    const response = await question({ question: '', tone: 'cheerful' })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'That question cannot be asked',
      issues: ['question must not be empty', 'tone is not allowed here'],
    })
  })
})
