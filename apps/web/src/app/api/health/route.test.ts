import { afterEach, describe, expect, test, vi } from 'vitest'
import { closePool } from '@/lib/db'
import { GET } from './route'

describe('GET /api/health', () => {
  afterEach(async () => {
    await closePool()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  test('reports ok when the database is reachable', async () => {
    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', database: 'ok' })
  })

  test('reports 503 when the database is unreachable', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://ecokart:ecokart@127.0.0.1:1/ecokart')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await GET()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      status: 'error',
      database: 'unreachable',
    })
  })
})
