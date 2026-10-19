import { inArray, lt } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import type { Database } from '../../db/client.ts'
import { rateLimits } from '../../db/schema/index.ts'
import type { QueueDefinition } from '../../lib/queue.ts'
import { LONGEST_WINDOW_SECONDS } from './service.ts'

/*
 * The nightly clean-up of rate limit counts. A row is reused for its key's
 * next window, so only keys that stopped coming back, such as a visitor's
 * address, are left behind.
 */

export const REMOVE_EXPIRED_RATE_LIMITS_QUEUE = 'rate-limits.remove-expired'

export const rateLimitQueues: QueueDefinition[] = [
  {
    name: REMOVE_EXPIRED_RATE_LIMITS_QUEUE,
    options: {
      retryLimit: 3,
      retryDelay: 60,
      retryBackoff: true,
      expireInSeconds: 300,
      deleteAfterSeconds: 7 * 24 * 60 * 60,
    },
  },
]

/** Rows removed per statement, so no statement holds many locks for long. */
const BATCH = 1000

/**
 * Removes counts whose window started more than LONGEST_WINDOW_SECONDS ago,
 * which no rule is still counting, and returns how many.
 */
export async function removeExpiredRateLimits(
  db: Database,
  now: Date = new Date(),
): Promise<number> {
  const expired = lt(
    rateLimits.windowStart,
    new Date(now.getTime() - LONGEST_WINDOW_SECONDS * 1000),
  )
  let removed = 0
  for (;;) {
    const batch = db
      .select({ key: rateLimits.key })
      .from(rateLimits)
      .where(expired)
      .limit(BATCH)
      .for('update', { skipLocked: true })
    const deleted = await db
      .delete(rateLimits)
      .where(inArray(rateLimits.key, batch))
      .returning({ key: rateLimits.key })
    removed += deleted.length
    if (deleted.length < BATCH) return removed
  }
}

/**
 * Removes expired counts every night at 04:00 India time. A night the worker
 * was down gets one run when it starts again.
 */
export async function registerRateLimitJobs(
  boss: PgBoss,
  deps: { db: Database },
): Promise<void> {
  await boss.schedule(REMOVE_EXPIRED_RATE_LIMITS_QUEUE, '0 4 * * *', null, {
    tz: 'Asia/Kolkata',
    missed: 'once',
  })
  await boss.work(REMOVE_EXPIRED_RATE_LIMITS_QUEUE, async () => {
    const removed = await removeExpiredRateLimits(deps.db)
    if (removed > 0) console.info(`Removed expired rate limits: ${removed}`)
  })
}
