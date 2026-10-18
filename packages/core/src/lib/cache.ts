import { asc, gt, lt, sql } from 'drizzle-orm'
import type { Database, Transaction } from '../db/client.ts'
import { cacheInvalidations } from '../db/schema/index.ts'

/*
 * The shared log of cache tags that changed (backend spec step 9). Services
 * record tags in the transaction of the change, so a change that rolls back
 * refreshes nothing, and the worker records them the same way. Each web
 * container's cache handler reads the log about once a second and expires
 * those tags in its own memory. This keeps every container's page cache
 * current without Redis (design doc sections 2 and 9).
 */

/**
 * How far back each read looks again. A change whose transaction commits a
 * little after it recorded its tags would otherwise be missed by a reader
 * that looked in between.
 */
export const INVALIDATION_OVERLAP_SECONDS = 60

/** Rows older than this are deleted: every cached entry expires within a day. */
export const INVALIDATION_RETENTION_HOURS = 24

export async function recordCacheInvalidations(
  db: Database | Transaction,
  tags: readonly string[],
): Promise<void> {
  const unique = [...new Set(tags)]
  if (unique.length === 0) return
  // The time of this statement, not of the transaction's start, which could
  // be well before a reader's last look.
  await db
    .insert(cacheInvalidations)
    .values(unique.map((tag) => ({ tag, createdAt: sql`clock_timestamp()` })))
}

export interface CacheInvalidationRead {
  /** Rows recorded since the last read, with the overlap. */
  rows: { id: number; tag: string }[]
  /** The database's time when reading; pass it back as `since` next time. */
  readAt: string
}

/** The rows recorded since `since`, or in the last overlap on a first read. */
export async function readCacheInvalidations(
  db: Database,
  since: string | null,
): Promise<CacheInvalidationRead> {
  const clock = await db.execute<{ read_at: string }>(
    sql`select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as read_at`,
  )
  const readAt = clock.rows[0]!.read_at
  const rows = await db
    .select({ id: cacheInvalidations.id, tag: cacheInvalidations.tag })
    .from(cacheInvalidations)
    .where(
      gt(
        cacheInvalidations.createdAt,
        sql`${since ?? readAt}::timestamptz - make_interval(secs => ${INVALIDATION_OVERLAP_SECONDS})`,
      ),
    )
    .orderBy(asc(cacheInvalidations.id))
  return { rows, readAt }
}

/** Deletes rows past the retention time; returns how many. */
export async function deleteOldCacheInvalidations(
  db: Database | Transaction,
): Promise<number> {
  const result = await db
    .delete(cacheInvalidations)
    .where(
      lt(
        cacheInvalidations.createdAt,
        sql`now() - make_interval(hours => ${INVALIDATION_RETENTION_HOURS})`,
      ),
    )
  return result.rowCount ?? 0
}
