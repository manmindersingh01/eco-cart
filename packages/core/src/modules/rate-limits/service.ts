import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { Database, Transaction } from '../../db/client.ts'
import { rateLimits } from '../../db/schema/index.ts'

export interface RateLimitRule {
  /** What is being limited, for example `otp:email:<hash>`. */
  key: string
  limit: number
  windowSeconds: number
}

export interface RateLimitResult {
  allowed: boolean
  /** When the current window ends and the count starts again. */
  resetAt: Date
}

/**
 * Counts one use against a fixed-window limit with a single upsert, so two
 * requests racing for the last allowed use cannot both get it (design doc 8).
 *
 * For example, with a limit of 5 per hour, the sixth OTP request for the same
 * email address within the hour is refused until the next hour starts.
 */
export async function consumeRateLimit(
  db: Database | Transaction,
  rule: RateLimitRule,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const windowMs = rule.windowSeconds * 1000
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs)

  // In ON CONFLICT DO UPDATE every expression sees the row as it was, so a
  // row from an older window restarts at 1 and a current one counts up.
  const [row] = await db
    .insert(rateLimits)
    .values({ key: rule.key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.windowStart} < excluded.window_start then 1 else ${rateLimits.count} + 1 end`,
        windowStart: sql`greatest(${rateLimits.windowStart}, excluded.window_start)`,
      },
    })
    .returning({ count: rateLimits.count })

  return {
    allowed: (row?.count ?? Number.POSITIVE_INFINITY) <= rule.limit,
    resetAt: new Date(windowStart.getTime() + windowMs),
  }
}

/**
 * A rate-limit key for a personal value such as an email address, hashed so
 * the table never holds the address itself.
 */
export function hashedRateLimitKey(prefix: string, value: string): string {
  const digest = createHash('sha256').update(value).digest('hex')
  return `${prefix}:${digest.slice(0, 32)}`
}
