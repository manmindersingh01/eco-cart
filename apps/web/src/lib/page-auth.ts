import {
  ForbiddenError,
  NotSignedInError,
  type RequestContext,
} from '@ecokart/core'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { safeReturnTo, type CurrentAccount } from './auth-routing'
import { requireAdmin, requireSeller, type Session } from './request-context'

type ProtectedArea = 'admin' | 'seller'
type PageAccessByArea = {
  admin: {
    account: CurrentAccount
    context: Extract<RequestContext, { role: 'admin' }>
  }
  seller: {
    account: CurrentAccount
    context: Extract<RequestContext, { role: 'seller' }>
  }
}

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
  area: 'admin',
  returnTo: string,
): Promise<PageAccessByArea['admin']>
async function requirePageRole(
  area: 'seller',
  returnTo: string,
): Promise<PageAccessByArea['seller']>
async function requirePageRole(
  area: ProtectedArea,
  returnTo: string,
): Promise<PageAccessByArea[ProtectedArea]> {
  const requestHeaders = await headers()
  const requestedPath = safeReturnTo(
    requestHeaders.get('x-ecokart-protected-path'),
  )
  const protectedReturnTo = requestedPath?.startsWith(`/${area}`)
    ? requestedPath
    : returnTo
  let access: PageAccessByArea[ProtectedArea] | null = null
  let failure: unknown

  try {
    if (area === 'admin') {
      const { session, context } = await requireAdmin(requestHeaders)
      access = {
        account: accountFromSession(session, 'admin', null),
        context,
      }
    } else {
      const { session, context } = await requireSeller(requestHeaders)
      access = {
        account: accountFromSession(session, 'seller', context.sellerId),
        context,
      }
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
  if (!access)
    throw new Error('Protected account resolution returned no account')
  return access
}

export async function requireAdminPage(
  returnTo: string,
): Promise<CurrentAccount> {
  return (await requirePageRole('admin', returnTo)).account
}

export async function requireSellerPage(
  returnTo: string,
): Promise<CurrentAccount> {
  return (await requirePageRole('seller', returnTo)).account
}

export async function requireAdminPageContext(
  returnTo: string,
): Promise<Extract<RequestContext, { role: 'admin' }>> {
  return (await requirePageRole('admin', returnTo)).context
}

export async function requireSellerPageContext(
  returnTo: string,
): Promise<Extract<RequestContext, { role: 'seller' }>> {
  return (await requirePageRole('seller', returnTo)).context
}
