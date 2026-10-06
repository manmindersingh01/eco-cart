import { randomInt } from 'node:crypto'
import { loadAuthConfig, type Database } from '@ecokart/core'
import { lastEmailedCode } from '@ecokart/core/testing'
import { POST as authPost } from '@/app/api/auth/[...all]/route'

/*
 * Signs in through the real /api/auth route with an email code, the way the
 * browser will, and returns the session cookie for later requests.
 */

/**
 * Rate limits count per IP, so every request comes from its own address in
 * 198.18.0.0/15, a range reserved for tests. A counter would not do: each
 * test file starts its own, and files run at the same time.
 */
const randomTestIp = () =>
  `198.${18 + randomInt(2)}.${randomInt(256)}.${1 + randomInt(254)}`

function authRequest(path: string, body: object): Promise<Response> {
  const { baseURL } = loadAuthConfig()
  return authPost(
    new Request(`${baseURL}/api/auth${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: baseURL,
        'x-forwarded-for': randomTestIp(),
      },
      body: JSON.stringify(body),
    }),
  )
}

/** `owner` must be the database owner, to read the queued code back. */
export async function signInWithEmail(
  owner: Database,
  email: string,
): Promise<string> {
  const sent = await authRequest('/email-otp/send-verification-otp', {
    email,
    type: 'sign-in',
  })
  if (sent.status !== 200)
    throw new Error(`Sending a code failed: ${sent.status}`)
  const otp = await lastEmailedCode(
    owner,
    email,
    loadAuthConfig().encryptionKey,
  )
  const signedIn = await authRequest('/sign-in/email-otp', { email, otp })
  const cookie = signedIn.headers
    .getSetCookie()
    .find((value) => value.startsWith('ecokart.session_token='))
    ?.split(';')[0]
  if (!cookie) throw new Error(`Signing in failed: ${signedIn.status}`)
  return cookie
}
