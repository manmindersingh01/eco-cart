import { ForbiddenError, NotSignedInError } from '@ecokart/core'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { safeReturnTo, type CurrentAccount } from './auth-routing'
import { requireAdmin, requireSeller, type Session } from './request-context'

type ProtectedArea = 'admin' | 'seller'

function accountFromSession(
  session: Session,
  role: ProtectedArea,
  sellerId: string | null,
): CurrentAccount {
  const { user } = session
  return {
    id: user.id,
    name: user.name,
    email: user.email.endsWith('.invalid') ? null : user.email,
    phoneNumber: user.phoneNumber ?? null,
    role,
    sellerId,
  }
}

function signInDestination(
  requestHeaders: Headers,
  returnTo: string,
): `/sign-in?${string}` {
  const query = new URLSearchParams({ returnTo })
  const cookie = requestHeaders.get('cookie') ?? ''
  if (
    cookie.includes('ecokart.session_token=') ||
    cookie.includes('__Secure-ecokart.session_token=')
  ) {
    query.set('reason', 'session-ended')
  }
  return `/sign-in?${query.toString()}`
}

async function requirePageRole(
  area: ProtectedArea,
  returnTo: string,
): Promise<CurrentAccount> {
  const requestHeaders = await headers()
  const requestedPath = safeReturnTo(
    requestHeaders.get('x-ecokart-protected-path'),
  )
  const protectedReturnTo = requestedPath?.startsWith(`/${area}`)
    ? requestedPath
    : returnTo
  let account: CurrentAccount | null = null
  let failure: unknown

  try {
    if (area === 'admin') {
      const { session } = await requireAdmin(requestHeaders)
      account = accountFromSession(session, 'admin', null)
    } else {
      const { session, context } = await requireSeller(requestHeaders)
      account = accountFromSession(session, 'seller', context.sellerId)
    }
  } catch (error) {
    failure = error
  }

  if (failure instanceof NotSignedInError) {
    redirect(signInDestination(requestHeaders, protectedReturnTo))
  }
  if (failure instanceof ForbiddenError) {
    const reason =
      failure.message === 'Seller account is not set up yet'
        ? 'seller-not-ready'
        : 'wrong-role'
    redirect(`/access-denied?area=${area}&reason=${reason}`)
  }
  if (failure) throw failure
  if (!account)
    throw new Error('Protected account resolution returned no account')
  return account
}

export function requireAdminPage(returnTo: string): Promise<CurrentAccount> {
  return requirePageRole('admin', returnTo)
}

export function requireSellerPage(returnTo: string): Promise<CurrentAccount> {
  return requirePageRole('seller', returnTo)
}
