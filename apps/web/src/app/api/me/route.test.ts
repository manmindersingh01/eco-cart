import {
  createDatabase,
  createPool,
  loadAuthConfig,
  requireEnv,
} from '@ecokart/core'
import {
  createTestSeller,
  createTestUser,
  lastEmailedCode,
} from '@ecokart/core/testing'
import { afterAll, describe, expect, test } from 'vitest'
import { closePool } from '@/lib/db'
import { closeJobQueue } from '@/lib/queue'
import { POST as authPost } from '../auth/[...all]/route'
import { GET } from './route'

// The owner writes fixtures and reads queued codes; the routes under test
// use the web app's own connection, exactly as in production.
const ownerPool = createPool(requireEnv('MIGRATION_DATABASE_URL'), 'me-test')
const owner = createDatabase(ownerPool)
const { baseURL, encryptionKey } = loadAuthConfig()

afterAll(async () => {
  await closeJobQueue()
  await closePool()
  await ownerPool.end()
})

let ipCounter = 0
const authRequest = (path: string, body: object) =>
  authPost(
    new Request(`${baseURL}/api/auth${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: baseURL,
        'x-forwarded-for': `192.0.2.${++ipCounter}`,
      },
      body: JSON.stringify(body),
    }),
  )

/** Signs in through the real route with an email code. */
async function signIn(email: string): Promise<string> {
  const sent = await authRequest('/email-otp/send-verification-otp', {
    email,
    type: 'sign-in',
  })
  expect(sent.status).toBe(200)
  const otp = await lastEmailedCode(owner, email, encryptionKey)
  const signedIn = await authRequest('/sign-in/email-otp', { email, otp })
  expect(signedIn.status).toBe(200)
  return signedIn.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith('ecokart.session_token='))!
    .split(';')[0]!
}

const me = (cookie?: string) =>
  GET(
    new Request(`${baseURL}/api/me`, {
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
    const response = await me(await signIn(email))
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
    const response = await me(await signIn(sellerUser.email))
    expect(await response.json()).toMatchObject({
      role: 'seller',
      sellerId: seller.id,
    })
  })

  test('403 for a seller account that is not set up yet', async () => {
    const sellerUser = await createTestUser(owner, 'seller')
    const response = await me(await signIn(sellerUser.email))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: 'Seller account is not set up yet',
    })
  })
})
