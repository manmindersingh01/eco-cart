import { randomUUID } from 'node:crypto'
import {
  createAiModels,
  createDatabase,
  createPool,
  requireEnv,
  schema,
  writeListingDraft,
  type AiModels,
} from '@ecokart/core'
import {
  createTestCategory,
  createTestPhoto,
  createTestSeller,
  FAKE_AI_KEY,
  fakeChatReply,
  startFakeAiServer,
  testDatabase,
  type FakeAiServer,
} from '@ecokart/core/testing'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { PATCH as patchProduct } from '@/app/api/seller/products/[id]/route'
import { POST as createProduct } from '@/app/api/seller/products/route'
import { closePool } from '@/lib/db'
import { closeJobQueue } from '@/lib/queue'
import { getStorage } from '@/lib/storage'
import { apiRequest as request, withId } from '@/testing/requests'
import { signInWithEmail } from '@/testing/sign-in'
import { GET as getDraft } from './[id]/route'
import { POST as askForDraft } from './route'

/*
 * The listing builder through the API (backend spec step 19): the seller
 * asks, the worker's job writes the draft, and the seller reads it and
 * copies it into the product with the normal edit.
 */

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'listing-drafts-route-test',
)
const owner = createDatabase(ownerPool)
const workerPool = createPool(
  testDatabase('web').workerUrl,
  'listing-drafts-route-test-worker',
)
const worker = createDatabase(workerPool)

let fake: FakeAiServer
let models: AiModels
let sellerCookie: string
let otherSellerCookie: string
let buyerCookie: string
let categoryId: string

beforeAll(async () => {
  fake = await startFakeAiServer()
  models = createAiModels(fake.settings())
  // The web app's AI settings, pointing at the fake server, read on the
  // first request that needs them.
  vi.stubEnv('AI_ENABLED', 'true')
  vi.stubEnv('AI_BASE_URL', fake.url)
  vi.stubEnv('AI_API_KEY', FAKE_AI_KEY)
  vi.stubEnv('AI_CHAT_MODEL', 'deepseek/deepseek-v4.1-flash')
  vi.stubEnv('AI_VISION_MODEL', 'deepseek/deepseek-v4.1-flash')
  vi.stubEnv('AI_EMBED_MODEL', 'voyageai/voyage-multimodal-3.5')
  vi.stubEnv('AI_EMBED_DIMENSIONS', '1024')

  const [seller, other] = await Promise.all([
    createTestSeller(owner),
    createTestSeller(owner),
  ])
  sellerCookie = await signInWithEmail(owner, seller.owner.email)
  otherSellerCookie = await signInWithEmail(owner, other.owner.email)
  buyerCookie = await signInWithEmail(
    owner,
    `${crypto.randomUUID()}@example.test`,
  )
  categoryId = (await createTestCategory(owner)).id
})

afterAll(async () => {
  vi.unstubAllEnvs()
  await closeJobQueue()
  await closePool()
  await Promise.all([ownerPool.end(), workerPool.end(), fake.close()])
})

const suggestion = {
  title: 'Jute Shopping Bag with Cotton Handles',
  description: 'A sturdy bag of natural jute with soft cotton handles.',
  highlights: ['Holds up to 10 kg'],
  attributes: { Material: 'Jute' },
}

const draftBody = z.object({
  draft: z.strictObject({
    id: z.string(),
    status: z.string(),
    suggestion: z.unknown(),
    error: z.string().nullable(),
    createdAt: z.string(),
  }),
})
const errorBody = z.object({
  error: z.string(),
  issues: z.array(z.string()).optional(),
})

/** A draft product made through the API, with `photos` ready photos. */
async function draftProduct(photos = 1): Promise<string> {
  const response = await createProduct(
    request('/seller/products', {
      method: 'POST',
      cookie: sellerCookie,
      body: {
        categoryId,
        title: 'Jute bag',
        variants: [
          { sku: 'JUTE-1', pricePaise: 24_900, mrpPaise: 29_900, stock: 8 },
        ],
      },
    }),
  )
  expect(response.status).toBe(201)
  const { id } = z
    .object({ product: z.object({ id: z.string() }) })
    .parse(await response.json()).product
  for (let i = 0; i < photos; i++) await createTestPhoto(owner, id)
  return id
}

/** Asks as the seller, or as someone else, or signed out with null. */
const ask = (body: unknown, cookie: string | null = sellerCookie) =>
  askForDraft(
    request('/seller/listing-drafts', {
      method: 'POST',
      ...(cookie === null ? {} : { cookie }),
      body,
    }),
  )

const read = (id: string, cookie = sellerCookie) =>
  getDraft(request(`/seller/listing-drafts/${id}`, { cookie }), withId(id))

describe('POST /api/seller/listing-drafts and GET /api/seller/listing-drafts/{id}', () => {
  test('the seller asks, the job writes the draft, and the seller copies it in', async () => {
    const productId = await draftProduct(2)
    const asked = await ask({ productId })
    expect(asked.status).toBe(202)
    const { draft } = draftBody.parse(await asked.json())
    expect(draft).toMatchObject({ status: 'queued', suggestion: null })

    const waiting = await read(draft.id)
    expect(waiting.status).toBe(200)
    expect(draftBody.parse(await waiting.json()).draft.status).toBe('queued')

    // The worker's job.
    fake.queue(fakeChatReply(suggestion))
    await writeListingDraft(
      { db: worker, storage: getStorage(), ai: models },
      { requestId: draft.id, productId },
    )

    const ready = draftBody.parse(await (await read(draft.id)).json()).draft
    expect(ready).toMatchObject({
      id: draft.id,
      status: 'succeeded',
      suggestion,
      error: null,
    })

    const edited = await patchProduct(
      request(`/seller/products/${productId}`, {
        method: 'PATCH',
        cookie: sellerCookie,
        body: ready.suggestion,
      }),
      withId(productId),
    )
    expect(edited.status).toBe(200)
    expect(
      z
        .object({ product: z.object({ title: z.string() }).loose() })
        .parse(await edited.json()).product.title,
    ).toBe(suggestion.title)

    // The same photos with the new title are a new question.
    expect((await ask({ productId })).status).toBe(202)
  })

  test('the same photos asked about again answer 200 with the draft', async () => {
    const productId = await draftProduct()
    const { draft } = draftBody.parse(await (await ask({ productId })).json())
    fake.queue(fakeChatReply(suggestion))
    await writeListingDraft(
      { db: worker, storage: getStorage(), ai: models },
      { requestId: draft.id, productId },
    )
    const again = await ask({ productId })
    expect(again.status).toBe(200)
    expect(draftBody.parse(await again.json()).draft).toMatchObject({
      id: draft.id,
      status: 'succeeded',
      suggestion,
    })
  })

  test('answers 401, 403, 404, and 400 like every other route', async () => {
    const productId = await draftProduct()
    expect((await ask({ productId }, null)).status).toBe(401)
    expect((await ask({ productId }, buyerCookie)).status).toBe(403)
    expect((await ask({ productId }, otherSellerCookie)).status).toBe(404)

    const noPhoto = await ask({ productId: await draftProduct(0) })
    expect(noPhoto.status).toBe(400)
    expect(errorBody.parse(await noPhoto.json())).toEqual({
      error: 'A draft is written from the photos',
      issues: ['add a photo and wait until it is ready'],
    })
    const unknown = await ask({ productId, tone: 'cheerful' })
    expect(unknown.status).toBe(400)

    const { draft } = draftBody.parse(await (await ask({ productId })).json())
    expect((await read(draft.id, otherSellerCookie)).status).toBe(404)
    expect((await read(randomUUID())).status).toBe(404)
  })

  test('answers 429 with Retry-After once the seller’s AI calls are used up', async () => {
    const productId = await draftProduct()
    const { seller: full, owner: account } = await createTestSeller(owner)
    const fullCookie = await signInWithEmail(owner, account.email)
    // 100 calls today, the default seller limit.
    await owner.insert(schema.aiRequests).values(
      Array.from({ length: 100 }, () => ({
        feature: 'listing_draft',
        sellerId: full.id,
        provider: 'local',
        model: 'listing-drafts-route-test',
        inputHash: randomUUID(),
        status: 'succeeded',
      })),
    )
    const theirs = await createProduct(
      request('/seller/products', {
        method: 'POST',
        cookie: fullCookie,
        body: {
          categoryId,
          title: 'Coir doormat',
          variants: [
            { sku: 'COIR-1', pricePaise: 39_900, mrpPaise: 49_900, stock: 3 },
          ],
        },
      }),
    )
    const theirId = z
      .object({ product: z.object({ id: z.string() }) })
      .parse(await theirs.json()).product.id
    await createTestPhoto(owner, theirId)

    const refused = await ask({ productId: theirId }, fullCookie)
    expect(refused.status).toBe(429)
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(errorBody.parse(await refused.json()).error).toBe(
      'You have used today’s 100 AI calls; more are available after midnight India time',
    )
    // Another seller is not affected.
    expect((await ask({ productId })).status).toBe(202)
  })
})
