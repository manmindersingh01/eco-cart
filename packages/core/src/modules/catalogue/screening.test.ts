import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import { productModeration } from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import {
  createTestCategory,
  createTestProduct,
  createTestSeller,
  createTestUser,
} from '../../testing/fixtures.ts'
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
    await screenListing({ db: worker }, review.id)
    expect(await reviewRow(review.id)).toMatchObject({
      aiFlags: [
        { code: 'missing_description', detail: 'The description is empty' },
      ],
      aiRisk: 'medium',
      riskRank: 1,
      decision: null,
    })
    // Running again gives the same result.
    await screenListing({ db: worker }, review.id)
    expect((await reviewRow(review.id)).aiRisk).toBe('medium')
  })

  test('never changes a review that has a decision', async () => {
    const review = await openReview()
    const admin = await createTestUser(owner, 'admin')
    await owner
      .update(productModeration)
      .set({ decision: 'approved', decidedBy: admin.id, decidedAt: new Date() })
      .where(eq(productModeration.id, review.id))
    await screenListing({ db: worker }, review.id)
    expect(await reviewRow(review.id)).toMatchObject({
      aiFlags: [],
      aiRisk: null,
    })
  })

  test('does nothing for a review that does not exist', async () => {
    await expect(
      screenListing({ db: worker }, randomUUID()),
    ).resolves.toBeUndefined()
  })
})
