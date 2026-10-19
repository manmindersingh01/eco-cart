import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { createDatabase } from '../../db/client.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import { aiRequests, productModeration } from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import { createAiModels, type AiModels } from '../../lib/ai/index.ts'
import { imageSizeKey } from '../../lib/images.ts'
import { createObjectStorage, loadStorageConfig } from '../../lib/storage.ts'
import {
  fakeChatReply,
  startFakeAiServer,
  type FakeAiServer,
} from '../../testing/ai.ts'
import {
  createTestCategory,
  createTestPhoto,
  createTestProduct,
  createTestSeller,
  createTestUser,
} from '../../testing/fixtures.ts'
import { waitUntil } from '../../testing/locks.ts'
import { DAY_MS, indianDayStart } from '../ai/days.ts'
import { settingDefinitions } from '../settings/definitions.ts'
import {
  deterministicFlags,
  largeDiscountFlags,
  prohibitedTermFlags,
  riskOf,
  screenListing,
  wordsOf,
  type ListingText,
} from './screening.ts'

/*
 * The fixed screening checks (backend spec step 7). The prohibited terms
 * come from platform settings, which the settings tests own, so these tests
 * pass the terms in directly; the worker and web tests save real ones.
 */

const listing = (overrides: Partial<ListingText> = {}): ListingText => ({
  title: 'Bamboo Toothbrush, Pack of 4',
  description: 'Biodegradable handles.',
  highlights: ['Charcoal bristles'],
  attributes: { material: 'bamboo' },
  optionNames: ['Bristles'],
  optionValues: ['Soft', 'Medium'],
  ...overrides,
})

/** The prohibited-term flags of a listing with this title. */
const titleFlags = (title: string, terms: string[]) =>
  prohibitedTermFlags(listing({ title }), terms)

describe('prohibited terms', () => {
  test('match whole words and phrases, ignoring case, punctuation, and spacing', () => {
    expect(wordsOf('Toy-GUN,  2 pcs!')).toBe(' toy gun 2 pcs ')
    expect(titleFlags('Toy Gun for kids', ['gun'])).toEqual([
      { code: 'prohibited_term', detail: '"gun" appears in the title' },
    ])
    expect(titleFlags('toy-gun', ['gun'])).toHaveLength(1)
    expect(titleFlags('Air   Gun pellets', ['air gun'])).toHaveLength(1)
    expect(titleFlags('Air-gun pellets', ['air gun'])).toHaveLength(1)
    // Not inside another word, and a plural is its own term.
    expect(titleFlags('I begun a Burgundy guns set', ['gun'])).toEqual([])
    expect(titleFlags('Guns', ['guns'])).toHaveLength(1)
    // A phrase matches only as a whole.
    expect(titleFlags('Air freshener with a gun', ['air gun'])).toEqual([])
  })

  test('work in any script', () => {
    expect(
      prohibitedTermFlags(listing({ title: 'असली तंबाकू पाउडर' }), ['तंबाकू']),
    ).toHaveLength(1)
    expect(
      prohibitedTermFlags(listing({ title: 'तंबाकूरहित मंजन' }), ['तंबाकू']),
    ).toEqual([])
  })

  test('say every field a term appears in, one flag per term', () => {
    const flags = prohibitedTermFlags(
      listing({
        title: 'Ivory comb',
        description: 'Looks like ivory.',
        highlights: ['No ivory used'],
        attributes: { finish: 'ivory' },
        optionNames: ['Ivory shade'],
        optionValues: ['Ivory', 'Tobacco'],
      }),
      ['ivory', 'tobacco', 'gun'],
    )
    expect(flags).toEqual([
      {
        code: 'prohibited_term',
        detail:
          '"ivory" appears in the title, the description, the highlights, the attributes, the option names and the option values',
      },
      {
        code: 'prohibited_term',
        detail: '"tobacco" appears in the option values',
      },
    ])
    // Attribute names count too.
    expect(
      prohibitedTermFlags(listing({ attributes: { tobacco: 'none' } }), [
        'tobacco',
      ]),
    ).toEqual([
      {
        code: 'prohibited_term',
        detail: '"tobacco" appears in the attributes',
      },
    ])
  })

  test('a term of punctuation only never matches', () => {
    expect(prohibitedTermFlags(listing({ title: 'A - B' }), ['-'])).toEqual([])
  })
})

describe('large discounts', () => {
  test('flag a price 70% or more below its MRP, once, with the deepest', () => {
    expect(
      largeDiscountFlags([
        { sku: 'OK', pricePaise: 30_100, mrpPaise: 100_000 },
      ]),
    ).toEqual([])
    expect(
      largeDiscountFlags([
        { sku: 'EDGE', pricePaise: 30_000, mrpPaise: 100_000 },
      ]),
    ).toEqual([
      { code: 'large_discount', detail: 'EDGE sells 70% below its MRP' },
    ])
    expect(
      largeDiscountFlags([
        { sku: 'A', pricePaise: 25_000, mrpPaise: 100_000 },
        { sku: 'B', pricePaise: 19_900, mrpPaise: 79_900 },
        { sku: 'C', pricePaise: 10_000, mrpPaise: 100_000 },
        { sku: 'D', pricePaise: 90_000, mrpPaise: 100_000 },
      ]),
    ).toEqual([
      {
        code: 'large_discount',
        detail:
          'C sells 90% below its MRP, and 2 more variants 70% or more below',
      },
    ])
  })
})

describe('risk', () => {
  test('is the highest risk of the flags, and low without any', () => {
    expect(riskOf([])).toBe('low')
    expect(
      riskOf([
        { code: 'missing_description', detail: 'The description is empty' },
      ]),
    ).toBe('medium')
    expect(
      riskOf([
        { code: 'large_discount', detail: '' },
        { code: 'prohibited_term', detail: '' },
      ]),
    ).toBe('high')
    expect(() => riskOf([{ code: 'made_up', detail: '' }])).toThrow(
      'Screening flag made_up has no risk level',
    )
  })

  test('all the fixed checks together', () => {
    const flags = deterministicFlags(
      listing({ title: 'Toy gun', description: '   ' }),
      [{ sku: 'TG-1', pricePaise: 10_000, mrpPaise: 100_000 }],
      ['gun'],
    )
    expect(flags.map((flag) => flag.code)).toEqual([
      'prohibited_term',
      'large_discount',
      'missing_description',
    ])
    expect(riskOf(flags)).toBe('high')
  })
})

const storage = createObjectStorage(loadStorageConfig())

describe('screenListing', () => {
  const pools: DatabasePool[] = []
  const connect = (url: string) => {
    const pool = createPool(url, 'screening-test')
    pools.push(pool)
    return createDatabase(pool)
  }
  const worker = connect(requireEnv('WORKER_DATABASE_URL'))
  const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))
  let sellerId: string
  let categoryId: string

  beforeAll(async () => {
    sellerId = (await createTestSeller(owner)).seller.id
    categoryId = (await createTestCategory(owner)).id
  })

  afterAll(async () => {
    await Promise.all(pools.map((pool) => pool.end()))
  })

  /** A listing waiting for review: ₹500 against an MRP of ₹600, no description. */
  async function openReview() {
    const { product } = await createTestProduct(owner, {
      sellerId,
      categoryId,
      status: 'pending_review',
    })
    const [review] = await owner
      .insert(productModeration)
      .values({ productId: product.id })
      .returning()
    return review!
  }

  const reviewRow = async (id: string) =>
    (
      await owner
        .select()
        .from(productModeration)
        .where(eq(productModeration.id, id))
    )[0]!

  test('stores the flags and the risk on the review', async () => {
    const review = await openReview()
    await screenListing({ db: worker, storage, ai: null }, review.id)
    expect(await reviewRow(review.id)).toMatchObject({
      aiFlags: [
        { code: 'missing_description', detail: 'The description is empty' },
        { code: 'ai_not_checked', detail: 'AI checks are switched off' },
      ],
      aiRisk: 'medium',
      riskRank: 1,
      decision: null,
    })
    // Running again gives the same result.
    await screenListing({ db: worker, storage, ai: null }, review.id)
    expect((await reviewRow(review.id)).aiRisk).toBe('medium')
  })

  test('never changes a review that has a decision', async () => {
    const review = await openReview()
    const admin = await createTestUser(owner, 'admin')
    await owner
      .update(productModeration)
      .set({ decision: 'approved', decidedBy: admin.id, decidedAt: new Date() })
      .where(eq(productModeration.id, review.id))
    await screenListing({ db: worker, storage, ai: null }, review.id)
    expect(await reviewRow(review.id)).toMatchObject({
      aiFlags: [],
      aiRisk: null,
    })
  })

  test('does nothing for a review that does not exist', async () => {
    await expect(
      screenListing({ db: worker, storage, ai: null }, randomUUID()),
    ).resolves.toBeUndefined()
  })
})

describe('screenListing with the AI checks (step 20)', () => {
  const pools: DatabasePool[] = []
  const connect = (url: string) => {
    const pool = createPool(url, 'ai-screening-test')
    pools.push(pool)
    return createDatabase(pool)
  }
  const worker = connect(requireEnv('WORKER_DATABASE_URL'))
  const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))
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

  const fine = { prohibited: false, prohibitedReason: '', photos: [] }
  // The default: the settings tests own platform_settings, so nothing here saves one.
  const PLATFORM_LIMIT = settingDefinitions.ai_daily_limit_platform.default!

  /** A listing waiting for review with `photoCount` ready photos. */
  async function openReview(photoCount = 0) {
    const { product } = await createTestProduct(owner, {
      sellerId,
      categoryId,
      status: 'pending_review',
    })
    const photos = []
    for (let i = 0; i < photoCount; i++) {
      photos.push(await createTestPhoto(owner, product.id))
    }
    // A photo still being processed is never shown to the model.
    await createTestPhoto(owner, product.id, 'processing')
    const [review] = await owner
      .insert(productModeration)
      .values({ productId: product.id })
      .returning()
    return { review: review!, product, photos }
  }

  const reviewRow = async (id: string) =>
    (
      await owner
        .select()
        .from(productModeration)
        .where(eq(productModeration.id, id))
    )[0]!

  const screen = (reviewId: string, options = {}) =>
    screenListing({ db: worker, storage, ai }, reviewId, options)

  const userContent = (index = 0) =>
    z
      .object({
        messages: z.array(z.object({ role: z.string(), content: z.unknown() })),
      })
      .parse(fake.requests[index]!.body).messages[1]!.content

  test('sends the text and every ready photo in one call, and stores its answer', async () => {
    const { review, product, photos } = await openReview(2)
    fake.requests.length = 0
    fake.queue(fakeChatReply(fine, { costUsd: 0.000_3 }))
    await screen(review.id)

    expect(fake.requests).toHaveLength(1)
    const [text, ...images] = z
      .array(z.object({ type: z.string() }).loose())
      .parse(userContent())
    expect(text).toMatchObject({ type: 'text' })
    expect(JSON.stringify(text)).toContain(`Title: ${product.title}`)
    expect(images).toEqual(
      photos.map((photo) => ({
        type: 'image_url',
        image_url: {
          url: storage.publicUrl(imageSizeKey(photo.storageKey, 'card')),
        },
      })),
    )

    const row = await reviewRow(review.id)
    expect(row).toMatchObject({
      aiFlags: [
        { code: 'missing_description', detail: 'The description is empty' },
      ],
      aiRisk: 'medium',
    })
    const [call] = await owner
      .select()
      .from(aiRequests)
      .where(eq(aiRequests.id, row.aiRequestId!))
    expect(call).toMatchObject({
      feature: 'screening',
      sellerId,
      status: 'succeeded',
      costMicroUsd: 300,
    })
  })

  test('flags what the model found, and ignores photos the listing does not have', async () => {
    const { review } = await openReview(2)
    fake.queue(
      fakeChatReply({
        prohibited: true,
        prohibitedReason: 'An air gun is a weapon',
        photos: [
          { photo: 1, usable: true, reason: '' },
          { photo: 2, usable: false, reason: 'It shows a phone number' },
          { photo: 7, usable: false, reason: 'Blurry' },
        ],
      }),
    )
    await screen(review.id)
    expect(await reviewRow(review.id)).toMatchObject({
      aiFlags: [
        { code: 'missing_description', detail: 'The description is empty' },
        {
          code: 'ai_prohibited',
          detail:
            'The AI check says this may not be sold: An air gun is a weapon',
        },
        {
          code: 'ai_unusable_photo',
          detail: 'Photo 2 may be unusable: It shows a phone number',
        },
      ],
      aiRisk: 'high',
      riskRank: 0,
    })
  })

  test('asks the text model when the listing has no ready photo', async () => {
    const { review } = await openReview(0)
    fake.requests.length = 0
    fake.queue(fakeChatReply(fine))
    await screen(review.id)
    expect(typeof userContent()).toBe('string')
    expect(userContent()).toContain('Photos: 0')
  })

  test('only the fixed checks run when the day’s AI calls are used up', async () => {
    const { review } = await openReview(1)
    // A day three days ago, filled up to the limit, so today's count, which
    // other test files depend on, is untouched.
    const day = new Date(indianDayStart(new Date()).getTime() - 3 * DAY_MS)
    const filler = 'screening-limit-test'
    await owner.insert(aiRequests).values(
      Array.from({ length: PLATFORM_LIMIT }, () => ({
        feature: 'nl_search',
        provider: 'local',
        model: filler,
        inputHash: randomUUID(),
        status: 'succeeded',
        createdAt: new Date(day.getTime() + 60_000),
      })),
    )
    try {
      fake.requests.length = 0
      await screen(review.id, { now: new Date(day.getTime() + 3_600_000) })
      expect(fake.requests).toHaveLength(0)
      expect(await reviewRow(review.id)).toMatchObject({
        aiFlags: [
          { code: 'missing_description', detail: 'The description is empty' },
          {
            code: 'ai_not_checked',
            detail: 'Today’s AI calls are used up; check by hand',
          },
        ],
        aiRequestId: null,
      })
    } finally {
      await owner.delete(aiRequests).where(eq(aiRequests.model, filler))
    }
  })

  test('a model that answers badly twice leaves the listing for a person', async () => {
    const { review } = await openReview(0)
    fake.queue(fakeChatReply('not json'), fakeChatReply('{"prohibited": "no"}'))
    await screen(review.id)
    expect((await reviewRow(review.id)).aiFlags).toContainEqual({
      code: 'ai_not_checked',
      detail: 'The AI answer could not be used; check by hand',
    })
  })

  test('a provider failure is retried by the queue, and flagged on the last attempt', async () => {
    const { review } = await openReview(0)
    const down = { status: 502, body: { error: { message: 'Upstream error' } } }
    fake.queue(down)
    await expect(screen(review.id, { lastAttempt: false })).rejects.toThrow(
      'The AI provider answered 502: Upstream error',
    )
    expect((await reviewRow(review.id)).aiRisk).toBeNull()

    fake.queue(down)
    await screen(review.id, { lastAttempt: true })
    expect((await reviewRow(review.id)).aiFlags).toContainEqual({
      code: 'ai_not_checked',
      detail: 'The AI service could not be reached; check by hand',
    })
  })

  test('never overwrites a decision made while the model was answering', async () => {
    const { review } = await openReview(0)
    const admin = await createTestUser(owner, 'admin')
    fake.requests.length = 0
    fake.queue({ ...fakeChatReply(fine), delayMs: 500 })
    const screening = screen(review.id)
    // The model has the question, and has not answered yet.
    await waitUntil(async () => fake.requests.length === 1)
    await owner
      .update(productModeration)
      .set({ decision: 'approved', decidedBy: admin.id, decidedAt: new Date() })
      .where(eq(productModeration.id, review.id))
    await screening
    expect(await reviewRow(review.id)).toMatchObject({
      decision: 'approved',
      aiFlags: [],
      aiRisk: null,
    })
  })
})
