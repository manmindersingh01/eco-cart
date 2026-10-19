import { randomInt, randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { createDatabase } from '../../db/client.ts'
import { withContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import {
  categories,
  productEmbeddings,
  products,
  productVariants,
  searchQueries,
} from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import { NotConfiguredError, NotFoundError } from '../../errors.ts'
import { createAiModels, type AiModels } from '../../lib/ai/index.ts'
import { createObjectStorage, loadStorageConfig } from '../../lib/storage.ts'
import {
  fakeChatReply,
  fakeDirection,
  fakeEmbeddingsReply,
  startFakeAiServer,
  type FakeAiServer,
} from '../../testing/ai.ts'
import { validationIssues } from '../../testing/errors.ts'
import {
  createTestBrand,
  createTestPhoto,
  createTestSeller,
} from '../../testing/fixtures.ts'
import { listSimilarProducts } from '../catalogue/storefront.ts'
import { refreshProducts } from '../catalogue/summary.ts'
import { naturalSearch } from './natural.ts'
import { createSearchPhotoUpload, searchByPhoto } from './photos.ts'

/*
 * Search by meaning, by photo, and similar products (backend spec step 18),
 * against the fake AI server. Each test places its vectors around an axis
 * of its own, so its products are nearer to its query than anything another
 * test stored.
 */

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'meaning-test')
  pools.push(pool)
  return createDatabase(pool)
}
const web = connect(requireEnv('DATABASE_URL'))
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))
const storage = createObjectStorage(loadStorageConfig())

let fake: FakeAiServer
let ai: AiModels
let sellerId: string

let nextAxis = 10
/** An axis no other test in this file uses. */
const newAxis = () => (nextAxis += 10)

beforeAll(async () => {
  fake = await startFakeAiServer()
  ai = createAiModels(fake.settings())
  sellerId = (await createTestSeller(owner)).seller.id
})

afterAll(async () => {
  await fake.close()
  await Promise.all(pools.map((pool) => pool.end()))
})

/** A made-up word of letters only, so each test searches its own products. */
const word = (length = 9) =>
  Array.from({ length }, () => String.fromCharCode(97 + randomInt(26))).join('')

async function category(parentId: string | null = null) {
  const name = word()
  const [row] = await owner
    .insert(categories)
    .values({
      name: `Category ${name}`,
      slug: `category-${name}`,
      gstRateBps: 500,
      parentId,
      depth: parentId ? 1 : 0,
    })
    .returning()
  return row!
}

/** An approved product, with a text embedding when `vector` is given. */
async function listed(spec: {
  title?: string
  categoryId: string
  brandId?: string
  pricePaise?: number
  stock?: number
  status?: 'approved' | 'draft'
  vector?: number[]
}) {
  const id = randomUUID()
  await owner.insert(products).values({
    id,
    sellerId,
    categoryId: spec.categoryId,
    brandId: spec.brandId ?? null,
    title: spec.title ?? `Product ${word()}`,
    slug: `product-${id}`,
    hsnCode: '3924',
    gstRateBps: 1800,
    status: spec.status ?? 'approved',
    publishedAt: spec.status === 'draft' ? null : new Date(),
  })
  await owner.insert(productVariants).values({
    productId: id,
    sku: 'SKU',
    pricePaise: spec.pricePaise ?? 40_000,
    mrpPaise: spec.pricePaise ?? 40_000,
    stock: spec.stock ?? 5,
  })
  await owner.transaction((tx) => refreshProducts(tx, eq(products.id, id)))
  if (spec.vector) await embedText(id, spec.vector)
  return id
}

const embedText = (productId: string, embedding: number[]) =>
  owner.insert(productEmbeddings).values({
    productId,
    kind: 'text',
    model: 'test',
    contentHash: randomUUID(),
    embedding,
  })

async function embedPhoto(productId: string, embedding: number[]) {
  const photo = await createTestPhoto(owner, productId)
  await owner.insert(productEmbeddings).values({
    productId,
    kind: 'image',
    imageId: photo.id,
    model: 'test',
    contentHash: randomUUID(),
    embedding,
  })
}

const ids = (page: { items: { id: string }[] }) =>
  page.items.map((item) => item.id)

const search = (query: Record<string, string>, models: AiModels | null = ai) =>
  naturalSearch({ db: web, photos: storage, ai: models }, query)

/**
 * The sentence as the parser answers it. Query embeddings are cached for a
 * day, so every test searches words of its own.
 */
const parsed = (overrides: Record<string, unknown> = {}) =>
  fakeChatReply({
    query: `steel bottle ${word()}`,
    category: '',
    brand: '',
    minPriceRupees: null,
    maxPriceRupees: null,
    ...overrides,
  })

/**
 * The newest log row of a search, by its words, or of a photo search. The
 * keyword search tests log searches at the same time, but never by photo.
 */
async function logOf(queryText: string | null) {
  const [row] = await owner
    .select()
    .from(searchQueries)
    .where(
      queryText === null
        ? eq(searchQueries.kind, 'image')
        : eq(searchQueries.queryText, queryText),
    )
    .orderBy(desc(searchQueries.id))
    .limit(1)
  return row!
}

describe('naturalSearch', () => {
  test('lists the products nearest in meaning first, with the filters the sentence gave', async () => {
    const axis = newAxis()
    const top = await category()
    const leaf = await category(top.id)
    const other = await category()
    const brand = await createTestBrand(owner)
    const near = await listed({
      categoryId: leaf.id,
      brandId: brand.id,
      vector: fakeDirection(axis, 10),
    })
    const further = await listed({
      categoryId: leaf.id,
      brandId: brand.id,
      vector: fakeDirection(axis, 30),
    })
    // Each of these is left out by one filter.
    await listed({
      categoryId: leaf.id,
      brandId: brand.id,
      pricePaise: 90_000,
      vector: fakeDirection(axis, 1),
    })
    await listed({ categoryId: leaf.id, vector: fakeDirection(axis, 2) })
    await listed({
      categoryId: other.id,
      brandId: brand.id,
      vector: fakeDirection(axis, 3),
    })
    await listed({
      categoryId: leaf.id,
      brandId: brand.id,
      status: 'draft',
      vector: fakeDirection(axis, 0),
    })

    const sentence = `Show me a ${brand.name.toUpperCase()} steel bottle under 500 rupees ${word()}`
    const words = `steel bottle ${word()}`
    fake.requests.length = 0
    fake.queue(
      parsed({
        query: words,
        category: `${top.name} > ${leaf.name}`,
        brand: brand.name.toLowerCase(),
        maxPriceRupees: 500,
      }),
      fakeEmbeddingsReply([fakeDirection(axis)]),
    )
    const result = await search({ q: sentence })
    expect(result).toMatchObject({
      match: 'meaning',
      understood: {
        query: words,
        category: { id: leaf.id, name: leaf.name, slug: leaf.slug },
        brand: { name: brand.name, slug: brand.slug },
        minPricePaise: null,
        maxPricePaise: 50_000,
      },
      nextCursor: null,
    })
    expect(ids(result)).toEqual([near, further])

    const [parse, embed] = fake.requests
    const parseBody = z
      .object({ messages: z.array(z.object({ content: z.string() })) })
      .parse(parse!.body)
    expect(parseBody.messages[0]!.content).toContain(
      `${top.name} > ${leaf.name}`,
    )
    expect(parseBody.messages[1]!.content).toBe(sentence.toLowerCase())
    expect(embed!.body).toMatchObject({
      input: [words],
      input_type: 'search_query',
    })

    expect(await logOf(sentence)).toMatchObject({
      kind: 'natural',
      queryText: sentence,
      parsed: result.understood,
      resultCount: 2,
    })
  })

  test('pages through the list, and asks the model nothing for the next page', async () => {
    const axis = newAxis()
    const leaf = await category()
    const made = [
      await listed({ categoryId: leaf.id, vector: fakeDirection(axis, 5) }),
      await listed({ categoryId: leaf.id, vector: fakeDirection(axis, 15) }),
      await listed({ categoryId: leaf.id, vector: fakeDirection(axis, 25) }),
    ]
    const sentence = `something to carry water ${word()}`
    fake.queue(
      parsed({ query: 'water bottle' }),
      fakeEmbeddingsReply([fakeDirection(axis)]),
    )
    const first = await search({ q: sentence, category: leaf.slug, limit: '2' })
    expect(ids(first)).toEqual(made.slice(0, 2))

    const calls = fake.requests.length
    const second = await search({
      q: sentence,
      category: leaf.slug,
      limit: '2',
      cursor: first.nextCursor!,
    })
    expect(second.match).toBe('meaning')
    expect(ids(second)).toEqual([made[2]])
    expect(second.nextCursor).toBeNull()
    expect(fake.requests.length).toBe(calls)
  })

  test('what the shopper chose on the page wins over the sentence', async () => {
    const axis = newAxis()
    const leaf = await category()
    const dear = await listed({
      categoryId: leaf.id,
      pricePaise: 90_000,
      vector: fakeDirection(axis, 5),
    })
    const cheap = await listed({
      categoryId: leaf.id,
      pricePaise: 30_000,
      vector: fakeDirection(axis, 20),
    })
    fake.queue(
      parsed({ maxPriceRupees: 500 }),
      fakeEmbeddingsReply([fakeDirection(axis)]),
    )
    const result = await search({
      q: `steel bottle under 500 ${word()}`,
      category: leaf.slug,
      maxPricePaise: '100000',
    })
    expect(ids(result)).toEqual([dear, cheap])
  })

  test('searches the sentence as keywords when AI is off', async () => {
    const term = word(10)
    const made = await listed({
      title: `Copper ${term} bottle`,
      categoryId: (await category()).id,
    })
    const calls = fake.requests.length
    const result = await search({ q: `copper ${term}` }, null)
    expect(result).toMatchObject({ match: 'exact', understood: null })
    expect(ids(result)).toEqual([made])
    expect(fake.requests.length).toBe(calls)
    expect(await logOf(`copper ${term}`)).toMatchObject({
      kind: 'natural',
      parsed: null,
      resultCount: 1,
    })
  })

  test('searches as keywords when the parser does not answer in time', async () => {
    const term = word(10)
    const made = await listed({
      title: `Brass ${term} lamp`,
      categoryId: (await category()).id,
    })
    fake.queue({ ...parsed(), delayMs: 3500 })
    const result = await search({ q: `brass ${term}` })
    expect(result).toMatchObject({ match: 'exact', understood: null })
    expect(ids(result)).toEqual([made])
  }, 15_000)

  test('searches the cleaned words as keywords, with the filters, when the query cannot be embedded', async () => {
    const term = word(10)
    const leaf = await category()
    const made = await listed({
      title: `Clay ${term} pot`,
      categoryId: leaf.id,
    })
    await listed({
      title: `Clay ${term} pot`,
      categoryId: (await category()).id,
    })
    fake.queue(parsed({ query: `clay ${term}`, category: leaf.name }), {
      status: 502,
      body: { error: { message: 'Upstream error' } },
    })
    const result = await search({ q: `I want a clay ${term} for my garden` })
    expect(result).toMatchObject({
      match: 'exact',
      understood: { query: `clay ${term}`, category: { id: leaf.id } },
    })
    expect(ids(result)).toEqual([made])
  })

  test('falls back to keywords when no product with embeddings is left after the filters', async () => {
    const axis = newAxis()
    const term = word(10)
    const leaf = await category()
    // On sale but not embedded yet.
    const made = await listed({
      title: `Cane ${term} basket`,
      categoryId: leaf.id,
    })
    fake.queue(
      parsed({ query: `cane ${term}`, category: leaf.name }),
      fakeEmbeddingsReply([fakeDirection(axis)]),
    )
    const result = await search({ q: `cane ${term} please` })
    expect(result.match).toBe('exact')
    expect(ids(result)).toEqual([made])
  })

  test('refuses the next page of a list by meaning when AI cannot answer', async () => {
    const axis = newAxis()
    const leaf = await category()
    await listed({ categoryId: leaf.id, vector: fakeDirection(axis, 5) })
    await listed({ categoryId: leaf.id, vector: fakeDirection(axis, 10) })
    const sentence = `a gift for my mother ${word()}`
    fake.queue(
      parsed({ query: 'gift' }),
      fakeEmbeddingsReply([fakeDirection(axis)]),
    )
    const first = await search({ q: sentence, category: leaf.slug, limit: '1' })
    await expect(
      search(
        {
          q: sentence,
          category: leaf.slug,
          limit: '1',
          cursor: first.nextCursor!,
        },
        null,
      ),
    ).rejects.toThrow(NotConfiguredError)
  })

  test('checks its parameters like keyword search', async () => {
    expect(await validationIssues(search({ q: ' ' }))).toEqual([
      'q must not be empty',
    ])
    expect(await validationIssues(search({ q: 'x'.repeat(201) }))).toEqual([
      'q must be at most 200 characters',
    ])
  })
})

/** A photo the shopper uploaded: only its first bytes matter here. */
async function uploaded(
  bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]),
) {
  const { key } = await createSearchPhotoUpload(storage, {
    contentType: 'image/jpeg',
    size: bytes.length,
  })
  await storage.write(key, bytes, { contentType: 'image/jpeg' })
  return key
}

const byPhoto = (query: Record<string, string>, models: AiModels | null = ai) =>
  searchByPhoto({ db: web, storage, ai: models }, query)

describe('searchByPhoto', () => {
  test('lists the products with the nearest photos, each once', async () => {
    const axis = newAxis()
    const leaf = await category()
    const twoPhotos = await listed({ categoryId: leaf.id })
    await embedPhoto(twoPhotos, fakeDirection(axis, 40))
    await embedPhoto(twoPhotos, fakeDirection(axis, 5))
    const onePhoto = await listed({ categoryId: leaf.id })
    await embedPhoto(onePhoto, fakeDirection(axis, 20))

    const photo = await uploaded()
    fake.requests.length = 0
    fake.queue(fakeEmbeddingsReply([fakeDirection(axis)]))
    const page = await byPhoto({ photo, category: leaf.slug })
    expect(ids(page)).toEqual([twoPhotos, onePhoto])
    expect(fake.requests[0]!.body).toMatchObject({ input_type: 'search_query' })
    expect(JSON.stringify(fake.requests[0]!.body)).toContain(photo)
    expect(await logOf(null)).toMatchObject({
      kind: 'image',
      queryText: null,
      resultCount: 2,
    })

    // The same photo again, for example for the next page: from the cache.
    const calls = fake.requests.length
    expect(ids(await byPhoto({ photo, category: leaf.slug }))).toEqual([
      twoPhotos,
      onePhoto,
    ])
    expect(fake.requests.length).toBe(calls)
  })

  test('refuses a photo that did not arrive, a file that is not a photo, and a made-up key', async () => {
    const { key } = await createSearchPhotoUpload(storage, {
      contentType: 'image/png',
      size: 100,
    })
    expect(await validationIssues(byPhoto({ photo: key }))).toEqual([
      'the photo did not arrive; upload it again',
    ])
    const text = await uploaded(Buffer.from('not a photo at all'))
    expect(await validationIssues(byPhoto({ photo: text }))).toEqual([
      'it must be a JPEG, PNG, or WebP photo of at most 5 MB',
    ])
    expect(
      await validationIssues(byPhoto({ photo: 'invoices/secret.pdf' })),
    ).toEqual(['photo must be the key of an uploaded photo'])
  })

  test('answers 503 when AI is off or the provider does not answer', async () => {
    const photo = await uploaded()
    await expect(byPhoto({ photo }, null)).rejects.toThrow(
      new NotConfiguredError('Search by photo is switched off'),
    )
    fake.queue({ status: 502, body: { error: { message: 'Upstream error' } } })
    await expect(byPhoto({ photo })).rejects.toThrow(
      new NotConfiguredError(
        'Search by photo is not available right now; try again in a moment',
      ),
    )
  })

  test('the upload form takes one photo of a known type and size', async () => {
    const upload = await createSearchPhotoUpload(storage, {
      contentType: 'image/webp',
      size: 2_000_000,
    })
    expect(upload.key).toMatch(/^uploads\/search\/[0-9a-f-]{36}$/)
    expect(upload.fields['Content-Type']).toBe('image/webp')
    expect(upload.maxBytes).toBe(5 * 1024 * 1024)
    expect(
      await validationIssues(
        createSearchPhotoUpload(storage, {
          contentType: 'image/gif',
          size: 10,
        }),
      ),
    ).toEqual(['contentType must be image/jpeg, image/png, or image/webp'])
    expect(
      await validationIssues(
        createSearchPhotoUpload(storage, {
          contentType: 'image/jpeg',
          size: 6_000_000,
        }),
      ),
    ).toHaveLength(1)
  })
})

/** The similar products of the product at `slug`, as a visitor sees them. */
const similar = (slug: string) =>
  withContext(web, { role: 'anonymous' }, (tx) =>
    listSimilarProducts(tx, storage, slug),
  )

describe('listSimilarProducts', () => {
  test('lists the nearest products in the same category that are on sale and in stock', async () => {
    const axis = newAxis()
    const leaf = await category()
    const subject = await listed({
      categoryId: leaf.id,
      vector: fakeDirection(axis),
    })
    const near = await listed({
      categoryId: leaf.id,
      vector: fakeDirection(axis, 10),
    })
    const far = await listed({
      categoryId: leaf.id,
      vector: fakeDirection(axis, 40),
    })
    await listed({
      categoryId: (await category()).id,
      vector: fakeDirection(axis, 5),
    })
    await listed({
      categoryId: leaf.id,
      stock: 0,
      vector: fakeDirection(axis, 2),
    })
    await listed({
      categoryId: leaf.id,
      status: 'draft',
      vector: fakeDirection(axis, 1),
    })

    const result = await similar(`product-${subject}`)
    expect(result).toMatchObject({ productId: subject, categoryId: leaf.id })
    expect(ids(result)).toEqual([near, far])
  })

  test('is empty until the product is embedded, and 404 for a product not on sale', async () => {
    const leaf = await category()
    const plain = await listed({ categoryId: leaf.id })
    expect((await similar(`product-${plain}`)).items).toEqual([])
    const draft = await listed({ categoryId: leaf.id, status: 'draft' })
    await expect(similar(`product-${draft}`)).rejects.toThrow(NotFoundError)
  })
})
