import { loadAuthConfig, type Database } from '@ecokart/core'
import { lastEmailedCode } from '@ecokart/core/testing'
import { POST as authPost } from '@/app/api/auth/[...all]/route'

/*
 * Signs in through the real /api/auth route with an email code, the way the
 * browser will, and returns the session cookie for later requests.
 */

let ipCounter = 0

function authRequest(path: string, body: object): Promise<Response> {
  const { baseURL } = loadAuthConfig()
  return authPost(
    new Request(`${baseURL}/api/auth${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: baseURL,
        // Rate limits count per IP, so every sign-in uses its own.
        'x-forwarded-for': `192.0.2.${(++ipCounter % 250) + 1}`,
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
