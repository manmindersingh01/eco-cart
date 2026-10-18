import { randomUUID } from 'node:crypto'
import { count, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { createDatabase, type Transaction } from '../../db/client.ts'
import { withContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import { aiRequests, productImages, products } from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import {
  ConflictError,
  NotConfiguredError,
  NotFoundError,
  TooManyRequestsError,
} from '../../errors.ts'
import { createAiModels, type AiModels } from '../../lib/ai/index.ts'
import { imageSizeKey } from '../../lib/images.ts'
import { startJobQueue, type JobQueue } from '../../lib/queue.ts'
import { createObjectStorage, loadStorageConfig } from '../../lib/storage.ts'
import {
  fakeChatReply,
  startFakeAiServer,
  type FakeAiServer,
} from '../../testing/ai.ts'
import { rejectionOf, validationIssues } from '../../testing/errors.ts'
import {
  createTestCategory,
  createTestPhoto,
  createTestProduct,
  createTestSeller,
} from '../../testing/fixtures.ts'
import { settingDefinitions } from '../settings/definitions.ts'
import {
  DRAFT_LISTING_QUEUE,
  getListingDraft,
  requestListingDraft,
  writeListingDraft,
} from './drafts.ts'
import { updateProduct, type SellerContext } from './products.ts'
import type { ListingSuggestion } from './types.ts'

/*
 * The listing builder (backend spec step 19): the request as the web app
 * makes it, and the job as the worker runs it, against the fake AI server.
 */

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'drafts-test')
  pools.push(pool)
  return createDatabase(pool)
}
const web = connect(requireEnv('DATABASE_URL'))
const worker = connect(requireEnv('WORKER_DATABASE_URL'))
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))
const storage = createObjectStorage(loadStorageConfig())

// The default: the settings tests own platform_settings, so nothing here
// saves one.
const SELLER_LIMIT = settingDefinitions.ai_daily_limit_seller.default!

let fake: FakeAiServer
let ai: AiModels
let queue: JobQueue
let categoryId: string
let categoryName: string

beforeAll(async () => {
  fake = await startFakeAiServer()
  ai = createAiModels(fake.settings())
  queue = await startJobQueue(requireEnv('DATABASE_URL'), 'drafts-test')
  const category = await createTestCategory(owner)
  categoryId = category.id
  categoryName = category.name
})

afterAll(async () => {
  await queue.stop()
  await fake.close()
  await Promise.all(pools.map((pool) => pool.end()))
})

const suggestion: ListingSuggestion = {
  title: 'Jute Shopping Bag with Cotton Handles',
  description: 'A sturdy bag of natural jute with soft cotton handles.',
  highlights: ['Holds up to 10 kg', 'Folds flat'],
  attributes: { Material: 'Jute', Colour: 'Natural' },
}

async function newSeller(): Promise<SellerContext> {
  const { owner: account, seller } = await createTestSeller(owner)
  return { role: 'seller', userId: account.id, sellerId: seller.id }
}

/** A draft product of `seller` with `photoCount` ready photos. */
async function draftProduct(
  seller: SellerContext,
  photoCount = 2,
  status: 'draft' | 'pending_review' | 'rejected' = 'draft',
) {
  const { product } = await createTestProduct(owner, {
    sellerId: seller.sellerId,
    categoryId,
    status,
  })
  const photos = []
  for (let i = 0; i < photoCount; i++) {
    photos.push(await createTestPhoto(owner, product.id))
  }
  // A photo still being processed is never shown to the model.
  await createTestPhoto(owner, product.id, 'processing')
  return { product, photos }
}

const asSeller = <T>(
  seller: SellerContext,
  work: (tx: Transaction) => Promise<T>,
) => withContext(web, seller, work)

const ask = (
  seller: SellerContext,
  productId: string,
  models: AiModels | null = ai,
) =>
  asSeller(seller, (tx) =>
    requestListingDraft(tx, { storage, queue, ai: models }, seller, {
      productId,
    }),
  )

const read = (seller: SellerContext, draftId: string) =>
  asSeller(seller, (tx) => getListingDraft(tx, seller, draftId))

const write = (
  draftId: string,
  productId: string,
  options: { models?: AiModels | null; lastAttempt?: boolean } = {},
) =>
  writeListingDraft(
    {
      db: worker,
      storage,
      ai: options.models === undefined ? ai : options.models,
    },
    { requestId: draftId, productId },
    { lastAttempt: options.lastAttempt ?? true },
  )

async function jobsFor(draftId: string): Promise<number> {
  const jobs = await owner.execute<{ count: number }>(
    sql`select count(*)::int as count from pgboss.job where name = ${DRAFT_LISTING_QUEUE} and data->>'requestId' = ${draftId}`,
  )
  return jobs.rows[0]!.count
}

async function rowsForSeller(sellerId: string): Promise<number> {
  const [row] = await owner
    .select({ n: count() })
    .from(aiRequests)
    .where(eq(aiRequests.sellerId, sellerId))
  return row!.n
}

const requestRow = async (id: string) =>
  (await owner.select().from(aiRequests).where(eq(aiRequests.id, id)))[0]!

/** The text and the image addresses of the fake server's last chat request. */
function lastQuestion() {
  const body = z
    .object({
      messages: z.array(
        z.object({
          content: z.union([
            z.string(),
            z.array(
              z.union([
                z.object({ type: z.literal('text'), text: z.string() }),
                z.object({
                  type: z.literal('image_url'),
                  image_url: z.object({ url: z.string() }),
                }),
              ]),
            ),
          ]),
        }),
      ),
    })
    .parse(fake.requests.at(-1)!.body)
  const content = body.messages[1]!.content
  if (typeof content === 'string') return { text: content, images: [] }
  return {
    text: content
      .flatMap((part) => (part.type === 'text' ? [part.text] : []))
      .join(''),
    images: content.flatMap((part) =>
      part.type === 'image_url' ? [part.image_url.url] : [],
    ),
  }
}

describe('requestListingDraft and writeListingDraft', () => {
  test('a seller asks for a draft, and the worker writes it from the ready photos', async () => {
    const seller = await newSeller()
    const { product, photos } = await draftProduct(seller)

    const asked = await ask(seller, product.id)
    expect(asked).toMatchObject({
      status: 'queued',
      suggestion: null,
      error: null,
    })
    expect(await jobsFor(asked.id)).toBe(1)

    fake.queue(fakeChatReply(suggestion, { costUsd: 0.000_5 }))
    await write(asked.id, product.id)
    const question = lastQuestion()
    expect(question.text).toContain(`Category: ${categoryName}`)
    expect(question.text).toContain(
      `The seller's working title: ${product.title}`,
    )
    expect(question.text).toContain('Photos: 2')
    expect(question.images).toEqual(
      photos.map((photo) =>
        storage.publicUrl(imageSizeKey(photo.storageKey, 'card')),
      ),
    )

    expect(await read(seller, asked.id)).toEqual({
      id: asked.id,
      status: 'succeeded',
      suggestion,
      error: null,
      createdAt: asked.createdAt,
    })
    expect(await requestRow(asked.id)).toMatchObject({
      feature: 'listing_draft',
      sellerId: seller.sellerId,
      userId: null,
      status: 'succeeded',
      costMicroUsd: 500,
    })

    // Nothing reached the product; the seller copies the draft in with the
    // normal edit, which accepts it as it is.
    const [unchanged] = await owner
      .select({ title: products.title })
      .from(products)
      .where(eq(products.id, product.id))
    expect(unchanged!.title).toBe(product.title)
    const edited = await asSeller(seller, (tx) =>
      updateProduct(tx, storage, seller, product.id, suggestion),
    )
    expect(edited).toMatchObject(suggestion)
  })

  test('the same photos and details asked about again get the same draft at once, for nothing', async () => {
    const seller = await newSeller()
    const { product } = await draftProduct(seller, 1)
    const first = await ask(seller, product.id)
    fake.queue(fakeChatReply(suggestion))
    await write(first.id, product.id)

    const rows = await rowsForSeller(seller.sellerId)
    const again = await ask(seller, product.id)
    expect(again).toMatchObject({
      id: first.id,
      status: 'succeeded',
      suggestion,
    })
    expect(await rowsForSeller(seller.sellerId)).toBe(rows)
    expect(await jobsFor(first.id)).toBe(1)

    // Another photo is another question.
    await createTestPhoto(owner, product.id)
    expect((await ask(seller, product.id)).status).toBe('queued')
  })

  test('works on a rejected listing too, which the seller can still change', async () => {
    const seller = await newSeller()
    const { product } = await draftProduct(seller, 1, 'rejected')
    expect((await ask(seller, product.id)).status).toBe('queued')
  })

  test('refuses another seller’s product, a listing that cannot change, and one without a ready photo', async () => {
    const seller = await newSeller()
    const other = await newSeller()
    const { product: theirs } = await draftProduct(other)
    await expect(ask(seller, theirs.id)).rejects.toThrow(
      new NotFoundError('There is no product with that id'),
    )
    await expect(ask(seller, randomUUID())).rejects.toThrow(NotFoundError)

    const { product: inReview } = await draftProduct(
      seller,
      1,
      'pending_review',
    )
    await expect(ask(seller, inReview.id)).rejects.toThrow(ConflictError)

    const { product: noPhotos } = await draftProduct(seller, 0)
    expect(await validationIssues(ask(seller, noPhotos.id))).toEqual([
      'add a photo and wait until it is ready',
    ])
    expect(
      await validationIssues(
        asSeller(seller, (tx) =>
          requestListingDraft(tx, { storage, queue, ai }, seller, {
            productId: 'not-an-id',
          }),
        ),
      ),
    ).toHaveLength(1)
    expect(await rowsForSeller(seller.sellerId)).toBe(0)
  })

  test('answers 503 when AI is switched off, and 429 once the seller’s calls are used up', async () => {
    const seller = await newSeller()
    const { product } = await draftProduct(seller)
    await expect(ask(seller, product.id, null)).rejects.toThrow(
      new NotConfiguredError('The listing builder is switched off'),
    )

    await owner.insert(aiRequests).values(
      Array.from({ length: SELLER_LIMIT }, () => ({
        feature: 'listing_draft',
        sellerId: seller.sellerId,
        provider: 'local',
        model: 'drafts-test',
        inputHash: randomUUID(),
        status: 'succeeded',
      })),
    )
    const refused = await rejectionOf(
      ask(seller, product.id),
      TooManyRequestsError,
    )
    expect(refused.message).toBe(
      `You have used today’s ${SELLER_LIMIT} AI calls; more are available after midnight India time`,
    )
    expect(await rowsForSeller(seller.sellerId)).toBe(SELLER_LIMIT)
  })

  test('only the seller who asked can read a draft, and only a draft', async () => {
    const seller = await newSeller()
    const other = await newSeller()
    const { product } = await draftProduct(seller)
    const asked = await ask(seller, product.id)
    await expect(read(other, asked.id)).rejects.toThrow(
      new NotFoundError('There is no listing draft with that id'),
    )
    await expect(read(seller, 'not-an-id')).rejects.toThrow(NotFoundError)

    // A screening call for the seller's product is theirs to see, but is not
    // a draft.
    const [screening] = await owner
      .insert(aiRequests)
      .values({
        feature: 'screening',
        sellerId: seller.sellerId,
        provider: 'local',
        model: 'drafts-test',
        inputHash: randomUUID(),
        status: 'succeeded',
      })
      .returning({ id: aiRequests.id })
    await expect(read(seller, screening!.id)).rejects.toThrow(NotFoundError)
  })

  test('a model that answers badly twice leaves a failed draft with a plain message', async () => {
    const seller = await newSeller()
    const { product } = await draftProduct(seller, 1)
    const asked = await ask(seller, product.id)
    fake.queue(
      fakeChatReply('not json'),
      fakeChatReply({ ...suggestion, title: 'ok' }),
    )
    await write(asked.id, product.id, { lastAttempt: false })
    expect(await read(seller, asked.id)).toMatchObject({
      status: 'failed',
      suggestion: null,
      error:
        'The draft could not be made; try again later, or write the listing yourself',
    })
  })

  test('a provider failure is retried by the queue, and fails the draft on the last attempt', async () => {
    const seller = await newSeller()
    const { product } = await draftProduct(seller, 1)
    const asked = await ask(seller, product.id)
    const down = { status: 502, body: { error: { message: 'Upstream error' } } }

    fake.queue(down)
    await expect(
      write(asked.id, product.id, { lastAttempt: false }),
    ).rejects.toThrow('The AI provider answered 502: Upstream error')
    expect((await read(seller, asked.id)).status).toBe('queued')

    fake.queue(down)
    await write(asked.id, product.id, { lastAttempt: true })
    expect((await read(seller, asked.id)).status).toBe('failed')
  })

  test('a draft whose photos are gone, or asked for before AI was switched off, fails without a call', async () => {
    const seller = await newSeller()
    const { product } = await draftProduct(seller, 1)
    const gone = await ask(seller, product.id)
    const { product: later } = await draftProduct(seller, 1)
    const off = await ask(seller, later.id)
    await owner
      .update(productImages)
      .set({ status: 'failed', failureReason: 'The file is damaged' })
      .where(eq(productImages.productId, product.id))

    const calls = fake.requests.length
    await write(gone.id, product.id)
    expect(await requestRow(gone.id)).toMatchObject({
      status: 'failed',
      error: 'The product has no ready photo now',
    })
    await write(off.id, later.id, { models: null })
    expect(await requestRow(off.id)).toMatchObject({
      status: 'failed',
      error: 'AI features are switched off',
    })
    expect(fake.requests.length).toBe(calls)
  })

  test('local photos go inline to a remote provider, and unreadable ones are left out', async () => {
    const seller = await newSeller()
    const { product, photos } = await draftProduct(seller, 2)
    const card = Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ')
    await storage.write(imageSizeKey(photos[1]!.storageKey, 'card'), card, {
      contentType: 'image/webp',
    })
    // The fake server stands in for OpenRouter, which cannot reach the
    // local bucket.
    const remote: AiModels = {
      ...ai,
      vision: { ...ai.vision, provider: 'openrouter' },
    }
    const asked = await ask(seller, product.id, remote)
    fake.queue(fakeChatReply(suggestion))
    await write(asked.id, product.id, { models: remote })
    const question = lastQuestion()
    expect(question.images).toEqual([
      `data:image/webp;base64,${card.toString('base64')}`,
    ])
    expect(question.text).toContain('Photos: 1')

    const { product: unreadable } = await draftProduct(seller, 1)
    const none = await ask(seller, unreadable.id, remote)
    await write(none.id, unreadable.id, { models: remote })
    expect(await requestRow(none.id)).toMatchObject({
      status: 'failed',
      error: 'None of the photos could be read',
    })
  })

  test('a job run twice writes the draft once', async () => {
    const seller = await newSeller()
    const { product } = await draftProduct(seller, 1)
    const asked = await ask(seller, product.id)
    fake.queue(fakeChatReply(suggestion))
    await write(asked.id, product.id)
    const calls = fake.requests.length
    await write(asked.id, product.id)
    expect(fake.requests.length).toBe(calls)
    expect((await read(seller, asked.id)).suggestion).toEqual(suggestion)
  })
})
