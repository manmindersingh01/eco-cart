import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { createDatabase } from '../../db/client.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import {
  aiRequests,
  productEmbeddings,
  productImages,
  products,
} from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import { createAiModels, type AiModels } from '../../lib/ai/index.ts'
import { imageSizeKey } from '../../lib/images.ts'
import type { JobQueue } from '../../lib/queue.ts'
import { createObjectStorage, loadStorageConfig } from '../../lib/storage.ts'
import {
  fakeEmbeddingsReply,
  fakeVector,
  startFakeAiServer,
  type FakeAiServer,
} from '../../testing/ai.ts'
import {
  createTestCategory,
  createTestPhoto,
  createTestProduct,
  createTestSeller,
} from '../../testing/fixtures.ts'
import { waitUntil } from '../../testing/locks.ts'
import { aiInputHash } from '../ai/service.ts'
import {
  EMBED_PRODUCT_QUEUE,
  embeddingHash,
  embedProduct,
  productDocumentText,
  queueMissingEmbeddings,
} from './embeddings.ts'

/*
 * Product embeddings (backend spec step 18), as the worker makes them,
 * against the fake AI server.
 */

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'embeddings-test')
  pools.push(pool)
  return createDatabase(pool)
}
const worker = connect(requireEnv('WORKER_DATABASE_URL'))
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))
const storage = createObjectStorage(loadStorageConfig())
const MODEL = 'voyageai/voyage-multimodal-3.5'

let fake: FakeAiServer
let ai: AiModels
let sellerId: string
let categoryId: string

beforeAll(async () => {
  fake = await startFakeAiServer()
  ai = createAiModels(fake.settings())
  sellerId = (await createTestSeller(owner)).seller.id
  categoryId = (await createTestCategory(owner)).id
})

afterAll(async () => {
  await fake.close()
  await Promise.all(pools.map((pool) => pool.end()))
})

/** An approved product with `photoCount` ready photos. */
async function onSale(photoCount = 2) {
  const { product } = await createTestProduct(owner, {
    sellerId,
    categoryId,
    status: 'approved',
  })
  const photos = []
  for (let i = 0; i < photoCount; i++) {
    photos.push(await createTestPhoto(owner, product.id))
  }
  return { product, photos }
}

const embed = (productId: string, options = {}, models: AiModels | null = ai) =>
  embedProduct({ db: worker, ai: models, storage }, productId, options)

const rowsOf = (productId: string) =>
  owner
    .select()
    .from(productEmbeddings)
    .where(eq(productEmbeddings.productId, productId))

const embeddingsBody = z.object({
  input: z.union([
    z.array(z.string()),
    z.array(
      z.object({
        content: z.array(
          z.union([
            z.object({ type: z.literal('text'), text: z.string() }),
            z.object({
              type: z.literal('image_url'),
              image_url: z.object({ url: z.string() }),
            }),
          ]),
        ),
      }),
    ),
  ]),
  input_type: z.string(),
})

/** The inputs of the fake server's last embeddings request, as text or address. */
function lastInputs(): string[] {
  const body = embeddingsBody.parse(fake.requests.at(-1)!.body)
  return body.input.map((input) =>
    typeof input === 'string'
      ? input
      : input.content
          .map((part) =>
            part.type === 'text' ? part.text : part.image_url.url,
          )
          .join(''),
  )
}

describe('productDocumentText', () => {
  test('lists what a buyer would describe the product with, and skips what is empty', () => {
    expect(
      productDocumentText({
        title: 'Steel Bottle, 1 L',
        brandName: 'Green Basket',
        categoryName: 'Bottles',
        highlights: ['Keeps water cold', 'No plastic'],
        attributes: { Material: 'Steel', Capacity: '1 L' },
        optionValues: ['Blue', 'Green', 'Blue'],
        description: '  A bottle for every day.  ',
      }),
    ).toBe(
      [
        'Steel Bottle, 1 L',
        'Brand: Green Basket',
        'Category: Bottles',
        'Keeps water cold; No plastic',
        'Material: Steel; Capacity: 1 L',
        'Options: Blue, Green',
        'A bottle for every day.',
      ].join('\n'),
    )
    expect(
      productDocumentText({
        title: 'Jute Bag',
        brandName: null,
        categoryName: 'Bags',
        highlights: [],
        attributes: {},
        optionValues: [],
        description: '',
      }),
    ).toBe('Jute Bag\nCategory: Bags')
  })
})

describe('embedProduct', () => {
  test('embeds the text and every ready photo in one call, as documents', async () => {
    const { product, photos } = await onSale(2)
    await createTestPhoto(owner, product.id, 'processing')
    fake.queue(
      fakeEmbeddingsReply([fakeVector(1), fakeVector(2), fakeVector(3)]),
    )
    await embed(product.id)

    const body = embeddingsBody.parse(fake.requests.at(-1)!.body)
    expect(body.input_type).toBe('search_document')
    const [text, ...images] = lastInputs()
    expect(text).toContain(product.title)
    expect(images).toEqual(
      photos.map((photo) =>
        storage.publicUrl(imageSizeKey(photo.storageKey, 'card')),
      ),
    )

    const rows = await rowsOf(product.id)
    expect(
      rows
        .map((row) => ({
          kind: row.kind,
          imageId: row.imageId,
          model: row.model,
        }))
        .toSorted((a, b) => (a.imageId ?? '').localeCompare(b.imageId ?? '')),
    ).toEqual(
      [
        { kind: 'text', imageId: null, model: MODEL },
        ...photos.map((photo) => ({
          kind: 'image',
          imageId: photo.id,
          model: MODEL,
        })),
      ].toSorted((a, b) => (a.imageId ?? '').localeCompare(b.imageId ?? '')),
    )
    const imageRow = rows.find((row) => row.imageId === photos[0]!.id)!
    expect(imageRow.contentHash).toBe(
      embeddingHash(MODEL, photos[0]!.contentHash!),
    )
    expect(imageRow.embedding[0]).toBeCloseTo(fakeVector(2)[0]!, 5)

    // Logged like every AI call, without the vectors.
    const textRow = rows.find((row) => row.kind === 'text')!
    const contentHashes = [
      textRow.contentHash,
      ...photos.map((photo) => embeddingHash(MODEL, photo.contentHash!)),
    ]
    const [logged] = await owner
      .select()
      .from(aiRequests)
      .where(
        and(
          eq(aiRequests.feature, 'embedding'),
          eq(
            aiRequests.inputHash,
            aiInputHash('embedding', MODEL, {
              productId: product.id,
              contentHashes,
            }),
          ),
        ),
      )
    expect(logged).toMatchObject({ status: 'succeeded', result: null })
  })

  test('embeds again only what changed', async () => {
    const { product, photos } = await onSale(2)
    fake.queue(
      fakeEmbeddingsReply([fakeVector(4), fakeVector(5), fakeVector(6)]),
    )
    await embed(product.id)

    // Nothing changed: no call at all.
    const calls = fake.requests.length
    await embed(product.id)
    expect(fake.requests.length).toBe(calls)

    // A new title: only the text.
    await owner
      .update(products)
      .set({ title: 'Bamboo Bottle with a Cork Lid' })
      .where(eq(products.id, product.id))
    fake.queue(fakeEmbeddingsReply([fakeVector(7)]))
    await embed(product.id)
    expect(lastInputs()).toHaveLength(1)
    expect(lastInputs()[0]).toContain('Bamboo Bottle with a Cork Lid')

    // A removed photo takes its row with it; one that is no longer ready
    // loses its row on the next run.
    await owner.delete(productImages).where(eq(productImages.id, photos[0]!.id))
    await owner
      .update(productImages)
      .set({ status: 'failed', failureReason: 'The file is damaged' })
      .where(eq(productImages.id, photos[1]!.id))
    await embed(product.id)
    expect((await rowsOf(product.id)).map((row) => row.kind)).toEqual(['text'])
  })

  test('does nothing for a product not on sale, or with AI off', async () => {
    const { product: draft } = await createTestProduct(owner, {
      sellerId,
      categoryId,
      status: 'draft',
    })
    const { product } = await onSale(1)
    const calls = fake.requests.length
    await embed(draft.id)
    await embed(product.id, {}, null)
    expect(fake.requests.length).toBe(calls)
    expect(await rowsOf(product.id)).toEqual([])
  })

  test('a provider failure is retried by the queue, and given up on the last attempt', async () => {
    const { product } = await onSale(1)
    const down = { status: 502, body: { error: { message: 'Upstream error' } } }
    fake.queue(down)
    await expect(embed(product.id, { lastAttempt: false })).rejects.toThrow(
      'The AI provider answered 502: Upstream error',
    )
    fake.queue(down)
    await embed(product.id, { lastAttempt: true })
    expect(await rowsOf(product.id)).toEqual([])
  })

  test('keeps nothing the product no longer says, when it changed while the model answered', async () => {
    const { product } = await onSale(1)
    fake.requests.length = 0
    fake.queue({
      ...fakeEmbeddingsReply([fakeVector(8), fakeVector(9)]),
      delayMs: 400,
    })
    const embedding = embed(product.id)
    await waitUntil(async () => fake.requests.length === 1)
    await owner
      .update(products)
      .set({ title: 'Changed while embedding' })
      .where(eq(products.id, product.id))
    await embedding
    // The photo is stored; the old text is not, and the next run embeds the new one.
    expect((await rowsOf(product.id)).map((row) => row.kind)).toEqual(['image'])
  })
})

describe('queueMissingEmbeddings', () => {
  test('queues products on sale with no embeddings from the model, newest first', async () => {
    const sent: { name: string; data: object }[] = []
    const queue: Pick<JobQueue, 'send'> = {
      send: async (_tx, name, data) => {
        sent.push({ name, data })
      },
    }
    const { product: embedded } = await onSale(1)
    fake.queue(fakeEmbeddingsReply([fakeVector(10), fakeVector(11)]))
    await embed(embedded.id)
    const { product: missing } = await onSale(1)
    const { product: photoMissing } = await onSale(1)
    fake.queue(fakeEmbeddingsReply([fakeVector(12), fakeVector(13)]))
    await embed(photoMissing.id)
    await createTestPhoto(owner, photoMissing.id)

    // Other test files add products too, so look only at these three.
    await queueMissingEmbeddings(worker, queue, MODEL, 10_000)
    const queued = sent
      .filter((job) => job.name === EMBED_PRODUCT_QUEUE)
      .map(
        (job) => z.object({ productId: z.string() }).parse(job.data).productId,
      )
    expect(queued).toContain(missing.id)
    expect(queued).toContain(photoMissing.id)
    expect(queued).not.toContain(embedded.id)

    // After a change of model, everything is missing.
    sent.length = 0
    await queueMissingEmbeddings(worker, queue, 'another/model', 10_000)
    expect(
      sent.map(
        (job) => z.object({ productId: z.string() }).parse(job.data).productId,
      ),
    ).toContain(embedded.id)
  })
})
