import { randomInt, randomUUID } from 'node:crypto'
import { createDatabase, createPool, requireEnv, schema } from '@ecokart/core'
import {
  createTestCategory,
  createTestProduct,
  createTestSeller,
  createTestUser,
} from '@ecokart/core/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { closePool } from '@/lib/db'
import { signInWithEmail } from '@/testing/sign-in'
import { GET as gaps } from '../admin/search/gaps/route'
import { GET as search } from './route'

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'search-route-test',
)
const owner = createDatabase(ownerPool)

/** A made-up word of letters only, so these tests search their own products. */
const word = (length = 10) =>
  Array.from({ length }, () => String.fromCharCode(97 + randomInt(26))).join('')

/** Each test searches from its own address, so the limit counts only its own. */
const searchRequest = (
  query: string,
  address = `198.18.${randomInt(256)}.${randomInt(256)}`,
) =>
  new Request(`http://localhost:3000/api/search?${query}`, {
    headers: { 'x-forwarded-for': address },
  })

const term = word()
let productId: string
let adminCookie: string
let buyerCookie: string

beforeAll(async () => {
  const [{ seller }, category, admin] = await Promise.all([
    createTestSeller(owner),
    createTestCategory(owner),
    createTestUser(owner, 'admin'),
  ])
  const { product } = await createTestProduct(owner, {
    sellerId: seller.id,
    categoryId: category.id,
    publishedAt: new Date(),
  })
  productId = product.id
  // The fixture's search text is its title; give it a word of our own.
  await owner
    .update(schema.products)
    .set({ title: `${term} bottle`, searchText: `${term} bottle` })
    .where(eq(schema.products.id, product.id))
  adminCookie = await signInWithEmail(owner, admin.email)
  buyerCookie = await signInWithEmail(owner, `${randomUUID()}@example.test`)
})

afterAll(async () => {
  await closePool()
  await ownerPool.end()
})

describe('GET /api/search', () => {
  test('answers a page of results with the kind of match', async () => {
    const response = await search(searchRequest(`q=${term}`))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ match: 'exact', nextCursor: null })
    expect(body.items.map((item: { id: string }) => item.id)).toEqual([
      productId,
    ])

    const typo = await search(
      searchRequest(`q=${term.slice(0, 5)}${term.slice(6)}`),
    )
    expect((await typo.json()).match).toBe('similar')
  })

  test('answers 400 for a request it cannot use', async () => {
    const response = await search(searchRequest('q='))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Those search details are not valid',
      issues: ['q must not be empty'],
    })
  })

  test('answers 429 with Retry-After after 120 searches a minute from one address', async () => {
    const address = `198.19.${randomInt(256)}.${randomInt(256)}`
    // The limit counts per clock minute, so a real clock crossing a minute
    // would start the count again; only Date stands still, so the database
    // driver's timers keep running.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-12T10:00:01Z'))
    try {
      // The visitor cannot dodge the limit by sending a made-up first address.
      const responses = await Promise.all(
        Array.from({ length: 120 }, (_, index) =>
          search(
            searchRequest(`q=${term}`, `10.0.0.${index % 250}, ${address}`),
          ),
        ),
      )
      expect(responses.every((response) => response.status === 200)).toBe(true)

      const refused = await search(
        searchRequest(`q=${term}`, `10.9.9.9, ${address}`),
      )
      expect(refused.status).toBe(429)
      expect(refused.headers.get('retry-after')).toBe('59')
      expect(await refused.json()).toEqual({
        error:
          'Too many searches from your address; please wait a moment and try again',
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

const gapsRequest = (query: string, cookie?: string) =>
  new Request(`http://localhost:3000/api/admin/search/gaps?${query}`, {
    headers: cookie ? { cookie } : {},
  })

describe('GET /api/admin/search/gaps', () => {
  test('shows administrators the searches that found nothing', async () => {
    const missing = word(12)
    await search(searchRequest(`q=${missing}`))
    const response = await gaps(gapsRequest('days=1', adminCookie))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.gaps).toContainEqual({
      query: missing,
      searches: 1,
      lastSearchedAt: expect.any(String),
    })
  })

  test('answers 401 signed out, 403 for a buyer, and 400 for a bad range', async () => {
    expect((await gaps(gapsRequest(''))).status).toBe(401)
    expect((await gaps(gapsRequest('', buyerCookie))).status).toBe(403)
    const invalid = await gaps(gapsRequest('days=365', adminCookie))
    expect(invalid.status).toBe(400)
    expect((await invalid.json()).issues).toEqual(['days must be at most 90'])
  })
})
