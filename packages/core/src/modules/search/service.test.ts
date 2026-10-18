import { randomInt, randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool } from '../../db/pool.ts'
import {
  categories,
  products,
  productVariants,
  searchQueries,
} from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import { ForbiddenError, TooManyRequestsError } from '../../errors.ts'
import { validationIssues } from '../../testing/errors.ts'
import {
  createTestBrand,
  createTestSeller,
  createTestUser,
} from '../../testing/fixtures.ts'
import { refreshProducts } from '../catalogue/summary.ts'
import {
  consumeSearchAllowance,
  listSearchGaps,
  searchProducts,
  SEARCH_LIMIT,
} from './service.ts'

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'search-test',
)
const webPool = createPool(requireEnv('DATABASE_URL'), 'search-test')
const owner = createDatabase(ownerPool)
const web = createDatabase(webPool)
const photos = { publicUrl: (key: string) => `https://images.test/${key}` }
const anonymous: RequestContext = { role: 'anonymous' }

let sellerId: string
let top: typeof categories.$inferSelect
let leaf: typeof categories.$inferSelect

afterAll(async () => {
  await Promise.all([ownerPool.end(), webPool.end()])
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

beforeAll(async () => {
  sellerId = (await createTestSeller(owner)).seller.id
  top = await category()
  leaf = await category(top.id)
})

/** An approved product whose search text is built by refreshProducts. */
async function listed(spec: {
  title: string
  sellerId?: string
  highlights?: string[]
  categoryId?: string
  brandId?: string
  pricePaise?: number
  stock?: number
}) {
  const id = randomUUID()
  await owner.insert(products).values({
    id,
    sellerId: spec.sellerId ?? sellerId,
    categoryId: spec.categoryId ?? leaf.id,
    brandId: spec.brandId ?? null,
    title: spec.title,
    slug: `product-${id}`,
    highlights: spec.highlights ?? [],
    hsnCode: '3924',
    gstRateBps: 1800,
    status: 'approved',
    publishedAt: new Date(),
  })
  await owner.insert(productVariants).values({
    productId: id,
    sku: 'SKU',
    pricePaise: spec.pricePaise ?? 50_000,
    mrpPaise: spec.pricePaise ?? 50_000,
    stock: spec.stock ?? 5,
  })
  await owner.transaction((tx) => refreshProducts(tx, eq(products.id, id)))
  return id
}

const search = (query: Record<string, string>) =>
  withContext(web, anonymous, (tx) => searchProducts(tx, photos, query))

const issues = (query: Record<string, string>) =>
  validationIssues(search(query))

const daysAgo = (days: number) => sql`now() - make_interval(days => ${days})`

const logged = (text: string) =>
  owner.select().from(searchQueries).where(eq(searchQueries.queryText, text))

describe('keyword search', () => {
  test('matches words with English stemming and ranks closer matches first', async () => {
    // The stemmer keeps the "s" of a plural when the word already ends in
    // "s" or its only vowel is the last letter, so a fully random word made
    // this test fail about one run in 26. A vowel at the start and a "t" at
    // the end make the plural always stem back to the word.
    const term = `ka${word(6)}t`
    const once = await listed({ title: `Steel ${term} bottle` })
    const often = await listed({
      title: `${term} ${term} flask`,
      highlights: [`Keeps ${term} cold`],
    })
    await listed({ title: `Unrelated ${word()} bottle` })

    const result = await search({ q: `${term}s` })
    expect(result.match).toBe('exact')
    expect(result.items.map((item) => item.id)).toEqual([often, once])

    // websearch syntax: a quoted phrase, and a word left out with a minus.
    expect(
      (await search({ q: `"steel ${term}"` })).items.map((i) => i.id),
    ).toEqual([once])
    expect(
      (await search({ q: `${term} -flask` })).items.map((i) => i.id),
    ).toEqual([once])
  })

  test('falls back to similar words for a typo, and pages through them', async () => {
    const term = word(10)
    const made = [
      await listed({ title: `${term} spatula` }),
      await listed({ title: `${term} ladle` }),
      await listed({ title: `${term} tongs` }),
    ]
    // One letter missing from the middle of the word.
    const typo = term.slice(0, 4) + term.slice(5)

    const first = await search({ q: typo, limit: '2' })
    expect(first.match).toBe('similar')
    expect(first.items).toHaveLength(2)
    const second = await search({
      q: typo,
      limit: '2',
      cursor: first.nextCursor!,
    })
    expect(second.match).toBe('similar')
    expect(
      [...first.items, ...second.items].map((item) => item.id).toSorted(),
    ).toEqual(made.toSorted())
    expect(second.nextCursor).toBeNull()
  })

  test('reports an exact match with no results when similar words find nothing too', async () => {
    const result = await search({ q: word(14) })
    expect(result).toEqual({ items: [], nextCursor: null, match: 'exact' })
  })

  test('does not try similar words for queries shorter than three letters', async () => {
    const result = await search({ q: 'zq' })
    expect(result).toEqual({ items: [], nextCursor: null, match: 'exact' })
  })

  test('pages through exact matches that tie on rank without repeats or gaps', async () => {
    const term = word()
    const made = []
    for (let index = 0; index < 5; index++) {
      made.push(await listed({ title: `${term} jar` }))
    }
    const seen: string[] = []
    let cursor: string | undefined
    do {
      const page = await search({
        q: term,
        limit: '2',
        ...(cursor ? { cursor } : {}),
      })
      expect(page.match).toBe('exact')
      seen.push(...page.items.map((item) => item.id))
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    expect(seen).toHaveLength(5)
    expect(seen.toSorted()).toEqual(made.toSorted())
  })

  test('takes the storefront filters, a category, and every sort', async () => {
    const term = word()
    const brand = await createTestBrand(owner)
    const otherTop = await category()
    const cheap = await listed({
      title: `${term} cup`,
      pricePaise: 10_000,
      brandId: brand.id,
    })
    const dear = await listed({ title: `${term} pot`, pricePaise: 90_000 })
    const elsewhere = await listed({
      title: `${term} bowl`,
      pricePaise: 50_000,
      categoryId: otherTop.id,
    })
    const soldOut = await listed({
      title: `${term} lid`,
      pricePaise: 5_000,
      stock: 0,
    })
    const found = async (query: Record<string, string>) =>
      (await search({ q: term, ...query })).items.map((item) => item.id)

    expect(await found({ sort: 'price_asc' })).toEqual([cheap, elsewhere, dear])
    expect(await found({ sort: 'price_desc' })).toEqual([
      dear,
      elsewhere,
      cheap,
    ])
    expect(await found({ category: top.slug, sort: 'price_asc' })).toEqual([
      cheap,
      dear,
    ])
    expect(await found({ brand: brand.slug })).toEqual([cheap])
    expect(await found({ maxPricePaise: '50000', sort: 'price_asc' })).toEqual([
      cheap,
      elsewhere,
    ])
    expect(
      await found({ includeOutOfStock: 'true', sort: 'price_asc' }),
    ).toEqual([soldOut, cheap, elsewhere, dear])
    expect((await found({ sort: 'newest' })).toSorted()).toEqual(
      [cheap, dear, elsewhere].toSorted(),
    )
  })

  test('explains a request it cannot use', async () => {
    const hidden = await category()
    await owner
      .update(categories)
      .set({ isActive: false })
      .where(eq(categories.id, hidden.id))
    expect(await issues({})).toEqual(['q is required'])
    expect(await issues({ q: '   ' })).toEqual(['q must not be empty'])
    expect(await issues({ q: 'x'.repeat(101) })).toEqual([
      'q must be at most 100 characters',
    ])
    expect(await issues({ q: 'jar', sort: 'cheapest' })).toEqual([
      'sort must be one of newest, price_asc, price_desc, relevance',
    ])
    expect(await issues({ q: 'jar', category: 'no-such-category' })).toEqual([
      'category no-such-category is not a category on sale',
    ])
    expect(await issues({ q: 'jar', category: hidden.slug })).toEqual([
      `category ${hidden.slug} is not a category on sale`,
    ])
    expect(await issues({ q: 'jar', page: '2' })).toEqual([
      'page is not allowed here',
    ])
  })
})

describe('search log', () => {
  test('logs each new search anonymously, but not its later pages', async () => {
    const term = word()
    await listed({ title: `${term} basket` })
    await listed({ title: `${term} tray` })

    const first = await search({ q: `  ${term}   basket `, limit: '1' })
    const rows = await logged(`${term} basket`)
    expect(rows).toEqual([
      expect.objectContaining({
        kind: 'keyword',
        queryText: `${term} basket`,
        userId: null,
        sessionId: null,
        parsed: null,
        resultCount: 1,
      }),
    ])
    expect(rows[0]!.latencyMs).toBeGreaterThanOrEqual(0)

    await search({
      q: `${term} basket`,
      limit: '1',
      cursor: first.nextCursor ?? 'x',
    }).catch(() => null)
    expect(await logged(`${term} basket`)).toHaveLength(1)
  })

  test('records a search that found nothing with a count of zero', async () => {
    const term = word(12)
    await search({ q: term })
    expect((await logged(term)).map((row) => row.resultCount)).toEqual([0])
  })
})

describe('per-address limit', () => {
  test('allows 120 searches a minute from one address, then refuses with a wait', async () => {
    const address = `203.0.113.${randomInt(256)}-${randomUUID()}`
    const now = new Date('2026-10-11T10:00:30Z')
    const consume = (at: Date, from = address) =>
      withContext(web, anonymous, (tx) => consumeSearchAllowance(tx, from, at))

    for (let count = 0; count < SEARCH_LIMIT.limit; count++) {
      await consume(now)
    }
    const refused = await consume(now).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(TooManyRequestsError)
    expect(refused).toMatchObject({
      resetAt: new Date('2026-10-11T10:01:00Z'),
    })

    // Another address has its own count, and the next minute starts again.
    await consume(now, `${address}-other`)
    await consume(new Date('2026-10-11T10:01:00Z'))
  })
})

describe('catalogue gap report', () => {
  const admin: RequestContext = { role: 'system' }

  test('groups searches that found nothing, most frequent first', async () => {
    const often = word(11)
    const once = word(11)
    const found = word(11)
    const old = word(11)
    await owner.insert(searchQueries).values([
      { kind: 'keyword', queryText: often, resultCount: 0, latencyMs: 3 },
      {
        kind: 'keyword',
        queryText: often.toUpperCase(),
        resultCount: 0,
        latencyMs: 3,
      },
      { kind: 'natural', queryText: often, resultCount: 0, latencyMs: 3 },
      { kind: 'keyword', queryText: once, resultCount: 0, latencyMs: 3 },
      { kind: 'keyword', queryText: found, resultCount: 4, latencyMs: 3 },
      { kind: 'image', queryText: null, resultCount: 0, latencyMs: 3 },
    ])
    await owner.insert(searchQueries).values({
      kind: 'keyword',
      queryText: old,
      resultCount: 0,
      latencyMs: 3,
      createdAt: daysAgo(40),
    })

    const gaps = await withContext(web, admin, (tx) =>
      listSearchGaps(tx, admin),
    )
    const mine = gaps.filter((gap) =>
      [often, once, found, old].includes(gap.query),
    )
    expect(mine.map(({ query, searches }) => ({ query, searches }))).toEqual([
      { query: often, searches: 3 },
      { query: once, searches: 1 },
    ])
    expect(mine[0]!.lastSearchedAt).toBeInstanceOf(Date)

    const longer = await withContext(web, admin, (tx) =>
      listSearchGaps(tx, admin, { days: '90' }),
    )
    expect(longer.some((gap) => gap.query === old)).toBe(true)
  })

  test('is for administrators only, over 1 to 90 days', async () => {
    const buyer = await createTestUser(owner)
    const context: RequestContext = { role: 'buyer', userId: buyer.id }
    await expect(
      withContext(web, context, (tx) => listSearchGaps(tx, context)),
    ).rejects.toThrow(ForbiddenError)
    expect(
      await validationIssues(
        withContext(web, admin, (tx) =>
          listSearchGaps(tx, admin, { days: '0' }),
        ),
      ),
    ).toEqual(['days must be at least 1'])
    expect(
      await validationIssues(
        withContext(web, admin, (tx) =>
          listSearchGaps(tx, admin, { days: '91' }),
        ),
      ),
    ).toEqual(['days must be at most 90'])
  })

  test('administrators can read the log through row-level security, visitors cannot', async () => {
    const adminUser = await createTestUser(owner, 'admin')
    const asAdmin: RequestContext = { role: 'admin', userId: adminUser.id }
    await expect(
      withContext(web, asAdmin, (tx) => listSearchGaps(tx, asAdmin)),
    ).resolves.toBeInstanceOf(Array)
    const rows = await withContext(web, anonymous, (tx) =>
      tx.select().from(searchQueries).limit(1),
    )
    expect(rows).toEqual([])
  })
})

/** What a search function returns, called directly as a visitor. */
const matched = (fn: string, text: string) =>
  withContext(web, anonymous, async (tx) => {
    const result = await tx.execute<{ product_id: string }>(
      sql`select product_id from ${sql.raw(`app.${fn}`)}(${text})`,
    )
    return result.rows.map((row) => row.product_id)
  })

describe('search functions in the database', () => {
  test('return only products visitors may see, for both kinds of match', async () => {
    const term = word(10)
    const onSale = await listed({ title: `${term} jug` })
    const draft = await listed({ title: `${term} jug` })
    const deleted = await listed({ title: `${term} jug` })
    const suspended = (await createTestSeller(owner, 'suspended')).seller
    await listed({ title: `${term} jug`, sellerId: suspended.id })
    await owner
      .update(products)
      .set({ status: 'draft', publishedAt: null })
      .where(eq(products.id, draft))
    await owner
      .update(products)
      .set({ deletedAt: new Date() })
      .where(eq(products.id, deleted))

    expect(await matched('public_products_with_words', term)).toEqual([onSale])
    expect(
      await matched(
        'public_products_with_similar_words',
        term.slice(0, 4) + term.slice(5),
      ),
    ).toEqual([onSale])
  })
})
