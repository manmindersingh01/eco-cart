import { inArray } from 'drizzle-orm'
import { afterAll, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import { rateLimits } from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import { removeExpiredRateLimits } from './jobs.ts'
import { consumeRateLimit, LONGEST_WINDOW_SECONDS } from './service.ts'

/*
 * The nightly clean-up of rate limit counts. Other test files count uses at
 * the same time, some at fixed dates in 2026, so the job runs as if it were
 * early 2001, against counts from 2000 only.
 */

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'rate-limit-jobs-test')
  pools.push(pool)
  return createDatabase(pool)
}
const web = connect(requireEnv('DATABASE_URL'))
const worker = connect(requireEnv('WORKER_DATABASE_URL'))

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()))
})

const now = new Date('2001-03-01T00:00:00Z')
const hoursBefore = (hours: number) =>
  new Date(now.getTime() - hours * 60 * 60 * 1000)

const rule = (windowSeconds: number) => ({
  key: `test:${crypto.randomUUID()}`,
  limit: 5,
  windowSeconds,
})

const remaining = async (keys: string[]) =>
  (
    await web
      .select({ key: rateLimits.key })
      .from(rateLimits)
      .where(inArray(rateLimits.key, keys))
  ).map(({ key }) => key)

describe('the rate limit clean-up', () => {
  test('removes counts whose window started more than a day ago, and keeps the rest', async () => {
    const hourly = rule(60 * 60)
    const daily = rule(LONGEST_WINDOW_SECONDS)
    const lastMinute = rule(60)
    // The windows these fall in started 25, 23, and about 0 hours ago.
    await consumeRateLimit(web, hourly, hoursBefore(25))
    await consumeRateLimit(web, daily, hoursBefore(23))
    await consumeRateLimit(web, lastMinute, hoursBefore(0.01))

    expect(await removeExpiredRateLimits(worker, now)).toBe(1)
    expect(
      (await remaining([hourly.key, daily.key, lastMinute.key])).toSorted(),
    ).toEqual([daily.key, lastMinute.key].toSorted())
  })

  test('works through many counts a batch at a time', async () => {
    const keys = Array.from(
      { length: 2001 },
      () => `test:${crypto.randomUUID()}`,
    )
    await web
      .insert(rateLimits)
      .values(
        keys.map((key) => ({ key, windowStart: hoursBefore(48), count: 1 })),
      )
    expect(await removeExpiredRateLimits(worker, now)).toBe(2001)
    expect(await remaining(keys)).toEqual([])
  })
})

describe('a rate limit rule', () => {
  test('may not count over a window longer than the clean-up keeps', async () => {
    await expect(
      consumeRateLimit(web, rule(LONGEST_WINDOW_SECONDS + 1)),
    ).rejects.toThrow('A rate limit window may be at most 86400 seconds')
  })
})
