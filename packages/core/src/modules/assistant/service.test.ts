import { randomInt, randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { createDatabase } from '../../db/client.ts'
import { withContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import {
  aiRequests,
  brands,
  categories,
  productEmbeddings,
  products,
  productVariants,
} from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import { NotConfiguredError, TooManyRequestsError } from '../../errors.ts'
import { createAiModels, type AiModels } from '../../lib/ai/index.ts'
import {
  fakeChatReply,
  fakeDirection,
  fakeEmbeddingsReply,
  startFakeAiServer,
  type FakeAiServer,
} from '../../testing/ai.ts'
import { rejectionOf, validationIssues } from '../../testing/errors.ts'
import { createTestBrand, createTestSeller } from '../../testing/fixtures.ts'
import { getProductFacts } from '../catalogue/storefront.ts'
import { refreshProducts } from '../catalogue/summary.ts'
import {
  ASSISTANT_LIMIT,
  askAssistant,
  consumeAssistantAllowance,
} from './service.ts'

/*
 * The shopping assistant (backend spec step 20), against the fake AI
 * server. Each test places its products around an axis of its own, so they
 * are nearer its question than anything another test stored.
 */

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'assistant-test')
  pools.push(pool)
  return createDatabase(pool)
}
const web = connect(requireEnv('DATABASE_URL'))
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))
const photos = { publicUrl: (key: string) => `https://images.test/${key}` }

let fake: FakeAiServer
let ai: AiModels
let sellerId: string
let categoryId: string
let categoryName: string

let nextAxis = 300
const newAxis = () => (nextAxis += 10)

beforeAll(async () => {
  fake = await startFakeAiServer()
  ai = createAiModels(fake.settings())
  sellerId = (await createTestSeller(owner)).seller.id
  const name = `Bottles ${randomUUID().slice(0, 8)}`
  const [category] = await owner
    .insert(categories)
    .values({
      name,
      slug: `bottles-${randomUUID().slice(0, 8)}`,
      gstRateBps: 1800,
    })
    .returning()
  categoryId = category!.id
  categoryName = name
})

afterAll(async () => {
  await fake.close()
  await Promise.all(pools.map((pool) => pool.end()))
})

/** A product on sale, embedded at `vector` when given. */
async function listed(spec: {
  title: string
  prices?: number[]
  stock?: number
  brandId?: string
  vector?: number[]
  options?: { name: string; values: string[] }
  description?: string
  status?: 'approved' | 'draft'
}) {
  const id = randomUUID()
  await owner.insert(products).values({
    id,
    sellerId,
    categoryId,
    brandId: spec.brandId ?? null,
    title: spec.title,
    slug: `product-${id}`,
    description: spec.description ?? '',
    highlights: ['Keeps water cold'],
    attributes: { Material: 'Steel' },
    optionNames: spec.options ? [spec.options.name] : [],
    hsnCode: '7323',
    gstRateBps: 1800,
    status: spec.status ?? 'approved',
    publishedAt: spec.status === 'draft' ? null : new Date(),
  })
  const prices = spec.prices ?? [79_900]
  for (const [index, price] of prices.entries()) {
    await owner.insert(productVariants).values({
      productId: id,
      sku: `SKU-${index}`,
      options: spec.options
        ? { [spec.options.name]: spec.options.values[index] ?? '' }
        : {},
      pricePaise: price,
      mrpPaise: Math.max(price, 99_900),
      stock: spec.stock ?? 5,
    })
  }
  await owner.transaction((tx) => refreshProducts(tx, eq(products.id, id)))
  if (spec.vector) {
    await owner.insert(productEmbeddings).values({
      productId: id,
      kind: 'text',
      model: 'test',
      contentHash: randomUUID(),
      embedding: spec.vector,
    })
  }
  return id
}

const ask = (input: unknown, models: AiModels | null = ai) =>
  askAssistant({ db: web, photos, ai: models }, input)

/** A question of its own, so no answer comes from another test's cache. */
const newQuestion = (words: string) => `${words} (${randomUUID().slice(0, 8)})`

const chatBody = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.string() })),
})

/** The model's answer, as the fake server sends it. */
const answering = (overrides: Record<string, unknown>) =>
  fakeChatReply({
    answer: 'Here is what I found.',
    productIds: [],
    comparison: null,
    declined: false,
    ...overrides,
  })

describe('askAssistant', () => {
  test('answers from the facts of the nearest products and the ones the shopper names', async () => {
    const axis = newAxis()
    const near = await listed({
      title: 'Insulated Steel Bottle',
      vector: fakeDirection(axis, 10),
    })
    const further = await listed({
      title: 'Copper Bottle',
      vector: fakeDirection(axis, 25),
    })
    // Near in meaning but out of stock: found only when named.
    const soldOut = await listed({
      title: 'Glass Bottle',
      stock: 0,
      vector: fakeDirection(axis, 5),
    })
    // Not on sale: never shown, even when named.
    const draft = await listed({
      title: 'Draft Bottle',
      status: 'draft',
      vector: fakeDirection(axis, 1),
    })

    const asked = newQuestion('Which bottle keeps water cold?')
    fake.requests.length = 0
    fake.queue(
      fakeEmbeddingsReply([fakeDirection(axis)]),
      answering({
        answer: 'The Insulated Steel Bottle keeps water cold.',
        productIds: [near, further, 'made-up-id', near],
        comparison: {
          productIds: [near, soldOut],
          points: [{ aspect: 'Material', first: 'Steel', second: 'Glass' }],
        },
      }),
    )
    const answer = await ask({ question: asked, productIds: [soldOut, draft] })

    expect(answer.answer).toBe('The Insulated Steel Bottle keeps water cold.')
    expect(answer.declined).toBe(false)
    // Unknown and repeated ids are dropped; cards come from the catalogue.
    expect(answer.products.map((card) => card.id)).toEqual([near, further])
    expect(answer.products[0]).toMatchObject({
      title: 'Insulated Steel Bottle',
      minPricePaise: 79_900,
    })
    expect(answer.comparison).toMatchObject({
      products: [{ id: near }, { id: soldOut }],
      points: [{ aspect: 'Material', first: 'Steel', second: 'Glass' }],
    })

    const [embed, chat] = fake.requests
    expect(embed!.body).toMatchObject({
      input: [asked],
      input_type: 'search_query',
    })
    const { messages } = chatBody.parse(chat!.body)
    expect(messages[0]!.content).toContain(
      'only the product facts you are given',
    )
    const user = messages[1]!.content
    expect(user).toContain(`Question: ${asked}`)
    expect(user).toContain(`"title":"Insulated Steel Bottle"`)
    expect(user).toContain(`"price":"₹799"`)
    expect(user).toContain(`"category":"${categoryName}"`)
    expect(user).toContain(soldOut)
    expect(user).not.toContain('Draft Bottle')

    // Made as a visitor: nothing about the shopper reaches the log.
    const rows = await owner
      .select()
      .from(aiRequests)
      .where(
        and(
          eq(aiRequests.feature, 'assistant'),
          eq(aiRequests.status, 'succeeded'),
        ),
      )
    expect(
      rows.every((row) => row.userId === null && row.sellerId === null),
    ).toBe(true)
  })

  test('finds a follow-up by the turn before it, and sends the conversation', async () => {
    const axis = newAxis()
    await listed({ title: 'Bamboo Bottle', vector: fakeDirection(axis, 10) })
    const before = newQuestion('Do you have bamboo bottles?')
    const asked = 'Which one is the lightest?'
    fake.requests.length = 0
    fake.queue(fakeEmbeddingsReply([fakeDirection(axis)]), answering({}))
    await ask({
      question: asked,
      history: [
        { from: 'shopper', text: before },
        { from: 'assistant', text: 'Yes, the Bamboo Bottle.' },
      ],
    })
    expect(fake.requests[0]!.body).toMatchObject({
      input: [`${before}\n${asked}`],
    })
    const user = chatBody.parse(fake.requests[1]!.body).messages[1]!.content
    expect(user).toContain(
      `Earlier conversation:\nShopper: ${before}\nAssistant: Yes, the Bamboo Bottle.`,
    )
  })

  test('the same question about the same products is answered from the cache', async () => {
    const axis = newAxis()
    const only = await listed({
      title: 'Clay Bottle',
      vector: fakeDirection(axis, 10),
    })
    const asked = newQuestion('Is there a clay bottle?')
    fake.queue(
      fakeEmbeddingsReply([fakeDirection(axis)]),
      answering({ answer: 'Yes, the Clay Bottle.', productIds: [only] }),
    )
    await ask({ question: asked })
    const calls = fake.requests.length
    const again = await ask({ question: asked })
    expect(again.answer).toBe('Yes, the Clay Bottle.')
    expect(fake.requests.length).toBe(calls)
  })

  test('passes on a declined answer and drops a comparison of one product with itself', async () => {
    const axis = newAxis()
    const only = await listed({
      title: 'Cork Bottle',
      vector: fakeDirection(axis, 10),
    })
    fake.queue(
      fakeEmbeddingsReply([fakeDirection(axis)]),
      answering({
        answer: 'I cannot answer that from the products here.',
        declined: true,
        comparison: {
          productIds: [only, only],
          points: [{ aspect: 'Price', first: '₹799', second: '₹799' }],
        },
      }),
    )
    const answer = await ask({
      question: newQuestion('What is the weather in Pune?'),
    })
    expect(answer).toEqual({
      answer: 'I cannot answer that from the products here.',
      declined: true,
      products: [],
      comparison: null,
    })
  })

  test('answers 503 when AI is off or the model fails, and 400 for a question it cannot take', async () => {
    const axis = newAxis()
    await listed({ title: 'Tin Bottle', vector: fakeDirection(axis, 10) })
    await expect(ask({ question: 'Hello' }, null)).rejects.toThrow(
      new NotConfiguredError('The shopping assistant is switched off'),
    )
    const unavailable = new NotConfiguredError(
      'The shopping assistant is not available right now; try again in a moment',
    )
    fake.queue({ status: 502, body: { error: { message: 'Upstream error' } } })
    await expect(
      ask({ question: newQuestion('Any tin bottles?') }),
    ).rejects.toThrow(unavailable)

    fake.queue(
      fakeEmbeddingsReply([fakeDirection(axis)]),
      fakeChatReply('not json'),
      fakeChatReply({ answer: '' }),
    )
    await expect(
      ask({ question: newQuestion('Any tin bottles at all?') }),
    ).rejects.toThrow(unavailable)

    expect(
      await validationIssues(
        ask({
          question: '',
          history: Array.from({ length: 7 }, () => ({
            from: 'shopper',
            text: 'Hi',
          })),
          productIds: ['not-an-id'],
        }),
      ),
    ).toEqual([
      'question must not be empty',
      'history can have at most 6 turns',
      'productIds.0 must be a product id',
    ])
  })
})

describe('consumeAssistantAllowance', () => {
  test('allows 20 questions in 10 minutes from one address', async () => {
    const address = `203.0.113.${randomInt(256)}-${randomUUID()}`
    const now = new Date('2026-10-20T10:00:00Z')
    const consume = () =>
      withContext(web, { role: 'anonymous' }, (tx) =>
        consumeAssistantAllowance(tx, address, now),
      )
    for (let i = 0; i < ASSISTANT_LIMIT.limit; i++) await consume()
    const refused = await rejectionOf(consume(), TooManyRequestsError)
    expect(refused.message).toBe(
      'Too many questions from your address; please wait a few minutes and try again',
    )
    expect(refused.resetAt).toEqual(new Date('2026-10-20T10:10:00Z'))
  })
})

describe('getProductFacts', () => {
  test('gives what the product page shows, in the order asked, for products on sale only', async () => {
    const brand = await createTestBrand(owner)
    const inactive = await createTestBrand(owner, false)
    const ranged = await listed({
      title: 'Steel Bottle',
      prices: [49_900, 129_900],
      brandId: brand.id,
      options: { name: 'Size', values: ['500 ml', '1 L'] },
      description: `  ${'A bottle. '.repeat(100)}`,
    })
    const plain = await listed({ title: 'Plain Bottle', brandId: inactive.id })
    const draft = await listed({ title: 'Draft Bottle', status: 'draft' })
    await owner
      .update(brands)
      .set({ isActive: false })
      .where(eq(brands.id, inactive.id))

    const facts = await withContext(web, { role: 'anonymous' }, (tx) =>
      getProductFacts(tx, [plain, draft, ranged]),
    )
    expect(facts.map((fact) => fact.id)).toEqual([plain, ranged])
    expect(facts[0]).toMatchObject({
      brand: null,
      price: '₹799',
      rating: null,
      options: {},
    })
    expect(facts[1]).toMatchObject({
      title: 'Steel Bottle',
      brand: brand.name,
      category: categoryName,
      price: '₹499 to ₹1,299',
      mrp: '₹999',
      inStock: true,
      highlights: ['Keeps water cold'],
      attributes: { Material: 'Steel' },
      options: { Size: ['500 ml', '1 L'] },
    })
    expect(facts[1]!.description).toHaveLength(800)
  })
})
