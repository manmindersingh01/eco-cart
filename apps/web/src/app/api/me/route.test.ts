import { createDatabase, createPool, requireEnv } from '@ecokart/core'
import { createTestSeller, createTestUser } from '@ecokart/core/testing'
import { afterAll, describe, expect, test } from 'vitest'
import { closePool } from '@/lib/db'
import { closeJobQueue } from '@/lib/queue'
import { signInWithEmail } from '@/testing/sign-in'
import { GET } from './route'

// The owner writes fixtures and reads queued codes; the routes under test
// use the web app's own connection, exactly as in production.
const ownerPool = createPool(requireEnv('MIGRATION_DATABASE_URL'), 'me-test')
const owner = createDatabase(ownerPool)

afterAll(async () => {
  await closeJobQueue()
  await closePool()
  await ownerPool.end()
})

const me = (cookie?: string) =>
  GET(
    new Request('http://localhost:3000/api/me', {
      headers: cookie ? { cookie } : {},
    }),
  )

describe('GET /api/me', () => {
  test('401 when signed out', async () => {
    const response = await me()
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Not signed in' })
  })

  test('a buyer who signed in with an email code', async () => {
    const email = `${crypto.randomUUID()}@example.test`
    const response = await me(await signInWithEmail(owner, email))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      id: expect.any(String),
      name: '',
      email,
      phoneNumber: null,
      role: 'buyer',
      sellerId: null,
    })
  })

  test('a seller sees their seller id', async () => {
    const { owner: sellerUser, seller } = await createTestSeller(owner)
    const response = await me(await signInWithEmail(owner, sellerUser.email))
    expect(await response.json()).toMatchObject({
      role: 'seller',
      sellerId: seller.id,
    })
  })

  test('403 for a seller account that is not set up yet', async () => {
    const sellerUser = await createTestUser(owner, 'seller')
    const response = await me(await signInWithEmail(owner, sellerUser.email))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: 'Seller account is not set up yet',
    })
  })
})
