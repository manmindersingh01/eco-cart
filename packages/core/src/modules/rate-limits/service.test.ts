import { afterAll, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { createPool } from '../../db/pool.ts'
import { requireEnv } from '../../env.ts'
import { consumeRateLimit, hashedRateLimitKey } from './service.ts'

const pool = createPool(requireEnv('DATABASE_URL'), 'rate-limit-test')
const db = createDatabase(pool)

afterAll(async () => {
  await pool.end()
})

const rule = () => ({
  key: `test:${crypto.randomUUID()}`,
  limit: 2,
  windowSeconds: 60,
})

describe('consumeRateLimit', () => {
  test('allows uses up to the limit, then refuses until the window ends', async () => {
    const limit = rule()
    const now = new Date('2026-10-05T10:00:10Z')
    expect((await consumeRateLimit(db, limit, now)).allowed).toBe(true)
    expect((await consumeRateLimit(db, limit, now)).allowed).toBe(true)
    const refused = await consumeRateLimit(db, limit, now)
    expect(refused).toEqual({
      allowed: false,
      resetAt: new Date('2026-10-05T10:01:00Z'),
    })

    const nextWindow = new Date('2026-10-05T10:01:05Z')
    expect((await consumeRateLimit(db, limit, nextWindow)).allowed).toBe(true)
  })

  test('counts every use exactly once when requests race', async () => {
    const limit = { ...rule(), limit: 5 }
    const now = new Date('2026-10-05T10:00:10Z')
    const results = await Promise.all(
      Array.from({ length: 12 }, () => consumeRateLimit(db, limit, now)),
    )
    expect(results.filter((result) => result.allowed)).toHaveLength(5)
  })
})

describe('hashedRateLimitKey', () => {
  test('never contains the address itself', () => {
    const key = hashedRateLimitKey('otp:email', 'asha@example.test')
    expect(key).toMatch(/^otp:email:[0-9a-f]{32}$/)
    expect(key).not.toContain('asha')
    expect(hashedRateLimitKey('otp:email', 'asha@example.test')).toBe(key)
  })
})
