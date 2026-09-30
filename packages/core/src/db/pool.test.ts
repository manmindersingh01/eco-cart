import { afterEach, describe, expect, test } from 'vitest'
import { requireEnv } from '../env.ts'
import { checkDatabase, createPool, type DatabasePool } from './pool.ts'

describe('checkDatabase', () => {
  let pool: DatabasePool | undefined

  afterEach(async () => {
    await pool?.end()
    pool = undefined
  })

  test('resolves when the database is reachable', async () => {
    pool = createPool(requireEnv('DATABASE_URL'), 'ecokart-core-test')
    await expect(checkDatabase(pool)).resolves.toBeUndefined()
  })

  test('rejects when the database is unreachable', async () => {
    pool = createPool(
      'postgres://ecokart:ecokart@127.0.0.1:1/ecokart',
      'ecokart-core-test',
    )
    await expect(checkDatabase(pool)).rejects.toThrow('ECONNREFUSED')
  })
})
