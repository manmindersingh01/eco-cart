import { randomBytes } from 'node:crypto'
import {
  ForbiddenError,
  GUEST_CART_DAYS,
  loadAuthConfig,
  type Shopper,
} from '@ecokart/core'
import { getRequestContext } from './request-context'

/*
 * The guest cart cookie (backend spec step 11). A guest's cart is found by a
 * random token in this cookie; once they sign in, the cart moves into their
 * account and the cookie is cleared.
 */

const TOKEN = /^[A-Za-z0-9_-]{43}$/
// The nightly clean-up removes a guest cart once this cookie has run out.
const MAX_AGE_SECONDS = GUEST_CART_DAYS * 24 * 60 * 60

function cookieName(secure: boolean): string {
  // Like the session cookie: the __Secure- prefix only works on https.
  return secure ? '__Secure-ecokart.cart' : 'ecokart.cart'
}

const isSecure = () => loadAuthConfig().baseURL.startsWith('https://')

function readToken(headers: Headers): string | undefined {
  const name = cookieName(isSecure())
  for (const part of (headers.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) {
      const token = rest.join('=')
      return TOKEN.test(token) ? token : undefined
    }
  }
  return undefined
}

function setCookie(response: Response, token: string, maxAge: number) {
  const secure = isSecure()
  response.headers.append(
    'set-cookie',
    `${cookieName(secure)}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
  )
  return response
}

export interface ShopperRequest {
  /** A guest with their cart token, or a buyer with any guest token left. */
  context: Shopper
  /** Sets or clears the cart cookie on a successful answer. */
  finish: (response: Response) => Response
}

/**
 * A guest or a signed-in buyer, or 403 for a seller or administrator, who
 * shop with a separate buyer account. With `changesCart`, a guest without a
 * cookie gets a new token, and every guest's cookie is renewed for 30 days.
 */
export async function requireShopper(
  request: Request,
  options: { changesCart?: boolean } = {},
): Promise<ShopperRequest> {
  const { context } = await getRequestContext(request.headers)
  if (context.role !== 'anonymous' && context.role !== 'buyer') {
    throw new ForbiddenError('This needs a buyer account')
  }
  const cookieToken = readToken(request.headers)
  if (context.role === 'buyer') {
    return {
      context: { ...context, guestToken: cookieToken },
      // The service has moved the guest cart into the account by now.
      finish: (response) =>
        cookieToken ? setCookie(response, '', 0) : response,
    }
  }
  const token =
    cookieToken ??
    (options.changesCart ? randomBytes(32).toString('base64url') : undefined)
  return {
    context: { role: 'anonymous', guestToken: token },
    finish: (response) =>
      token && options.changesCart
        ? setCookie(response, token, MAX_AGE_SECONDS)
        : response,
  }
}
