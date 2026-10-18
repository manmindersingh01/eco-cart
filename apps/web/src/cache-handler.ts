import {
  createDatabase,
  createPool,
  readCacheInvalidations,
  recordCacheInvalidations,
  type CacheInvalidationRead,
} from '@ecokart/core/cache'
import defaultHandlers from 'next/dist/server/lib/cache-handlers/default.js'
import type { CacheHandler } from 'next/dist/server/lib/cache-handlers/types.js'

/*
 * The handler for 'use cache' (backend spec step 9, set in next.config.ts).
 *
 * Cached storefront answers stay in Next.js's own in-memory cache, one per
 * web container. What the containers share is which tags have changed: the
 * services record them in the cache_invalidations table, in the transaction
 * of each change, and this handler reads the new ones at most once a second,
 * before a request that reads the cache, and expires them here. That is how
 * a change made through another container, or by the worker (for example
 * order expiry giving stock back), refreshes this container's pages without
 * Redis. A revalidateTag call in this container is written to the table too.
 *
 * Next.js loads this file by itself with Node.js, outside the app's bundle,
 * so it uses only type-level TypeScript and imports packages, not '@/' paths.
 */

export interface InvalidationLog {
  read(since: string | null): Promise<CacheInvalidationRead>
  record(tags: string[]): Promise<void>
}

/** A container hears about a change made elsewhere within about a second. */
export const SYNC_INTERVAL_MS = 1000

// The same switch as Next.js's own cache logging.
const debug = process.env.NEXT_PRIVATE_DEBUG_CACHE
  ? console.debug.bind(console, 'SharedTagCacheHandler:')
  : undefined

/** The clock Next.js stamps cache entries with, in milliseconds. */
const clock = () => performance.timeOrigin + performance.now()

/** No cached entry lives longer than a day (the storefront cacheLife). */
const MAX_ENTRY_AGE_MS = 24 * 60 * 60 * 1000

export function createSharedTagCacheHandler(
  inner: CacheHandler,
  log: InvalidationLog,
  options: { syncIntervalMs?: number; now?: () => number } = {},
): CacheHandler {
  const interval = options.syncIntervalMs ?? SYNC_INTERVAL_MS
  const now = options.now ?? Date.now
  let lastSync = Number.NEGATIVE_INFINITY
  let readAt: string | null = null
  // Rows already applied: each read looks a minute back again, so a change
  // whose transaction committed late is not missed, but none is applied twice.
  let applied = new Set<number>()
  let syncing: Promise<void> | undefined
  // When this container expired each tag, exactly. Next.js keeps the same in
  // its tags manifest, but rounded to the millisecond, which in the
  // end-to-end check let a page read in the same millisecond come back
  // stale. An entry's timestamp is when its rendering started, so an entry
  // started before the tag expired may hold old data and is refused.
  const expiredAt = new Map<string, number>()

  async function expire(tags: string[], durations?: { expire?: number }) {
    const at = clock()
    for (const tag of tags) expiredAt.set(tag, at)
    for (const [tag, time] of expiredAt) {
      if (time < at - MAX_ENTRY_AGE_MS) expiredAt.delete(tag)
    }
    await inner.updateTags(tags, durations)
  }

  async function sync(): Promise<void> {
    lastSync = now()
    try {
      const read = await log.read(readAt)
      const fresh = read.rows.filter((row) => !applied.has(row.id))
      debug?.('read', read.rows.length, 'rows,', fresh.length, 'new', {
        since: readAt,
        readAt: read.readAt,
        tags: fresh.map((row) => row.tag),
      })
      if (fresh.length > 0) {
        // Expired now rather than served stale: an old price or stock level
        // is worse than a slower first visit.
        await expire([...new Set(fresh.map((row) => row.tag))])
      }
      applied = new Set(read.rows.map((row) => row.id))
      readAt = read.readAt
    } catch (error) {
      // Keep serving; the next request after the interval tries again.
      console.error('Could not read the cache invalidations', error)
    }
  }

  return {
    async get(cacheKey, softTags) {
      const entry = await inner.get(cacheKey, softTags)
      const stale = entry?.tags.some(
        (tag) =>
          (expiredAt.get(tag) ?? Number.NEGATIVE_INFINITY) >= entry.timestamp,
      )
      return stale ? undefined : entry
    },
    set: (cacheKey, pendingEntry) => inner.set(cacheKey, pendingEntry),
    getExpiration: (tags) => inner.getExpiration(tags),
    async refreshTags() {
      await inner.refreshTags()
      if (now() - lastSync < interval) return
      // Requests arriving together share one read.
      syncing ??= sync().finally(() => {
        syncing = undefined
      })
      await syncing
    },
    async updateTags(tags, durations) {
      await expire(tags, durations)
      try {
        await log.record(tags)
      } catch (error) {
        console.error('Could not record cache invalidations', error)
      }
    },
  }
}

/**
 * The log in PostgreSQL, connected on first use with a small pool of its own,
 * as ecokart_web. Without DATABASE_URL (a build without a database) the cache
 * stays local to this process.
 */
function databaseLog(): InvalidationLog {
  let log: InvalidationLog | undefined
  const connect = (): InvalidationLog | undefined => {
    const url = process.env.DATABASE_URL
    if (!url) return undefined
    if (!log) {
      const db = createDatabase(
        createPool(url, 'ecokart-web-cache', { maxConnections: 2 }),
      )
      log = {
        read: (since) => readCacheInvalidations(db, since),
        record: (tags) => recordCacheInvalidations(db, tags),
      }
    }
    return log
  }
  return {
    read: async (since) =>
      (await connect()?.read(since)) ?? { rows: [], readAt: since ?? '' },
    record: async (tags) => {
      await connect()?.record(tags)
    },
  }
}

// The same size as Next.js's own default cache.
const MAX_CACHE_BYTES = 50 * 1024 * 1024

export default createSharedTagCacheHandler(
  defaultHandlers.createDefaultCacheHandler(MAX_CACHE_BYTES),
  databaseLog(),
)
