import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, test } from 'vitest'
import { requireEnv } from '../env.ts'
import { createDatabase } from './client.ts'
import { withContext } from './context.ts'
import { createPool } from './pool.ts'

// One connection, so every query below reuses the same database session,
// exactly like a busy pooled connection in production.
const pool = createPool(requireEnv('DATABASE_URL'), 'ecokart-core-test', {
  maxConnections: 1,
})
const db = createDatabase(pool)

const readContext = sql`select app.role_name() as role, app.user_id() as "userId", app.seller_id() as "sellerId", app.guest_token() as "guestToken"`

afterAll(async () => {
  await pool.end()
})

describe('withContext', () => {
  const userId = '0b9f1c52-6a37-4c55-9d3e-1f1d2b8c0a11'
  const sellerId = '5e2d8f7a-1b4c-4e0d-8a6f-3c9b2d1e0f22'

  test('sets the context for the transaction', async () => {
    const result = await withContext(
      db,
      { role: 'seller', userId, sellerId },
      (tx) => tx.execute(readContext),
    )
    expect(result.rows[0]).toEqual({
      role: 'seller',
      userId,
      sellerId,
      guestToken: null,
    })
  })

  test('clears the context when the transaction ends', async () => {
    await withContext(db, { role: 'admin', userId }, (tx) =>
      tx.execute(sql`select 1`),
    )
    const after = await db.execute(readContext)
    expect(after.rows[0]).toEqual({
      role: 'anonymous',
      userId: null,
      sellerId: null,
      guestToken: null,
    })
  })

  test('clears the context when the transaction rolls back', async () => {
    await expect(
      withContext(db, { role: 'admin', userId }, async () => {
        throw new Error('rolled back')
      }),
    ).rejects.toThrow('rolled back')
    const after = await db.execute(readContext)
    expect(after.rows[0]).toMatchObject({ role: 'anonymous', userId: null })
  })

  test('carries the guest cart token for anonymous visitors', async () => {
    const result = await withContext(
      db,
      { role: 'anonymous', guestToken: 'guest-token-1' },
      (tx) => tx.execute(readContext),
    )
    expect(result.rows[0]).toMatchObject({
      role: 'anonymous',
      guestToken: 'guest-token-1',
    })
  })
})
