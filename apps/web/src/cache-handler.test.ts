import { randomUUID } from 'node:crypto'
import {
  createDatabase,
  createPool,
  readCacheInvalidations,
  recordCacheInvalidations,
} from '@ecokart/core/cache'
import defaultHandlers from 'next/dist/server/lib/cache-handlers/default.js'
import type { CacheHandler } from 'next/dist/server/lib/cache-handlers/types.js'
import { afterAll, describe, expect, test, vi } from 'vitest'
import {
  createSharedTagCacheHandler,
  SYNC_INTERVAL_MS,
  type InvalidationLog,
} from './cache-handler'

/*
 * The 'use cache' handler (backend spec step 9). Each test builds handlers
 * around a stand-in for Next.js's in-memory cache that records which tags it
 * was told to expire, so two "web containers" can share one real log.
 */

const pool = createPool(process.env.DATABASE_URL!, 'cache-handler-test')
const db = createDatabase(pool)
const databaseLog: InvalidationLog = {
  read: (since) => readCacheInvalidations(db, since),
  record: (tags) => recordCacheInvalidations(db, tags),
}

afterAll(async () => {
  await pool.end()
})

function memoryCache() {
  const expired: string[][] = []
  const cache: CacheHandler = {
    get: async () => undefined,
    set: async () => {},
    refreshTags: async () => {},
    getExpiration: async () => 0,
    updateTags: async (tags) => {
      expired.push(tags)
    },
  }
  return { cache, expired }
}

/** A clock the test moves by hand. */
function clock() {
  let time = 1_000_000
  return { now: () => time, advance: (ms: number) => (time += ms) }
}

/** The clock Next.js stamps cache entries with. */
const timeNow = () => performance.timeOrigin + performance.now()
const entry = (tags: string[]) =>
  Promise.resolve({
    value: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('cached page'))
        controller.close()
      },
    }),
    tags,
    stale: 30,
    timestamp: timeNow(),
    expire: 86_400,
    revalidate: 3_600,
  })

describe('shared cache tags', () => {
  test('a tag changed in one container expires in another at its next refresh', async () => {
    const first = memoryCache()
    const second = memoryCache()
    const a = createSharedTagCacheHandler(first.cache, databaseLog)
    const b = createSharedTagCacheHandler(second.cache, databaseLog)
    await b.refreshTags()
    second.expired.length = 0

    const tag = `product:${randomUUID()}`
    await a.updateTags([tag])
    expect(first.expired).toEqual([[tag]])

    // The next refresh of b, more than a second later, reads the log.
    await new Promise((resolve) => setTimeout(resolve, SYNC_INTERVAL_MS + 50))
    await b.refreshTags()
    expect(second.expired.flat()).toContain(tag)
  })

  test('a change recorded by a service or the worker expires too, once only', async () => {
    const time = clock()
    const local = memoryCache()
    const handler = createSharedTagCacheHandler(local.cache, databaseLog, {
      now: time.now,
    })
    await handler.refreshTags()

    // What invalidateStorefront does in the worker's transaction.
    const tag = `category:${randomUUID()}`
    await recordCacheInvalidations(db, [tag])
    time.advance(SYNC_INTERVAL_MS)
    await handler.refreshTags()
    time.advance(SYNC_INTERVAL_MS)
    // Still inside the minute each read looks back again.
    await handler.refreshTags()
    expect(local.expired.flat().filter((expired) => expired === tag)).toEqual([
      tag,
    ])
  })
})

/** A log that is always empty and counts its reads. */
function emptyLog() {
  const read = vi.fn<InvalidationLog['read']>(async (since) => ({
    rows: [],
    readAt: since ?? '2026-10-12T00:00:00.000000Z',
  }))
  return { read, record: vi.fn<InvalidationLog['record']>(async () => {}) }
}

describe('reading the log', () => {
  test('happens at most once a second, and requests arriving together share it', async () => {
    const time = clock()
    const fake = emptyLog()
    const handler = createSharedTagCacheHandler(memoryCache().cache, fake, {
      now: time.now,
    })
    await Promise.all([handler.refreshTags(), handler.refreshTags()])
    expect(fake.read).toHaveBeenCalledTimes(1)
    time.advance(SYNC_INTERVAL_MS - 1)
    await handler.refreshTags()
    expect(fake.read).toHaveBeenCalledTimes(1)
    time.advance(1)
    await handler.refreshTags()
    expect(fake.read).toHaveBeenCalledTimes(2)
    // Each read continues from the time of the one before.
    expect(fake.read.mock.calls.map(([since]) => since)).toEqual([
      null,
      '2026-10-12T00:00:00.000000Z',
    ])
  })

  test('keeps serving when the database cannot be reached', async () => {
    const time = clock()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const local = memoryCache()
    const handler = createSharedTagCacheHandler(
      local.cache,
      {
        read: () => Promise.reject(new Error('connection refused')),
        record: () => Promise.reject(new Error('connection refused')),
      },
      { now: time.now },
    )
    await expect(handler.refreshTags()).resolves.toBeUndefined()
    // A revalidateTag here still expires the tag in this container.
    await expect(handler.updateTags(['home'])).resolves.toBeUndefined()
    expect(local.expired).toEqual([['home']])
    expect(errors).toHaveBeenCalledTimes(2)
    errors.mockRestore()
  })
})

test('refuses an entry whose rendering started before its tag expired', async () => {
  const started = timeNow()
  const stored = {
    value: new ReadableStream<Uint8Array>(),
    tags: ['product:1'],
    stale: 30,
    timestamp: started,
    expire: 86_400,
    revalidate: 3_600,
  }
  const local = memoryCache()
  local.cache.get = async () => stored
  const handler = createSharedTagCacheHandler(local.cache, emptyLog())
  expect(await handler.get('page', [])).toBe(stored)
  await handler.updateTags(['product:1'])
  expect(await handler.get('page', [])).toBeUndefined()
  // A new entry rendered after the change is served again.
  stored.timestamp = timeNow() + 1
  expect(await handler.get('page', [])).toBe(stored)
})

describe("with Next.js's own in-memory cache", () => {
  test('the read right after a refresh never gets an entry whose tag expired', async () => {
    // Relying on Next.js's own check alone, some of these reads got the old
    // entry, because it rounds the expiry time to the millisecond.
    for (let attempt = 0; attempt < 30; attempt++) {
      const tag = `product:${randomUUID()}`
      const inner = defaultHandlers.createDefaultCacheHandler(1024 * 1024)
      let recorded = false
      const handler = createSharedTagCacheHandler(
        inner,
        {
          read: async () => ({
            rows: recorded ? [{ id: attempt + 1, tag }] : [],
            readAt: '2026-10-12T00:00:00.000000Z',
          }),
          record: async () => {},
        },
        { syncIntervalMs: 0 },
      )
      await handler.refreshTags()
      await handler.set(`page-${tag}`, entry([tag]))
      expect(await handler.get(`page-${tag}`, [])).toBeDefined()

      recorded = true
      await handler.refreshTags()
      expect(await handler.get(`page-${tag}`, [])).toBeUndefined()
    }
  })
})
