import {
  ForbiddenError,
  NotSignedInError,
  resolveRequestContext,
  type RequestArea,
  type RequestContext,
} from '@ecokart/core'
import { getAuth } from './auth'
import { getDatabase } from './db'

export type Session = NonNullable<
  Awaited<ReturnType<ReturnType<typeof getAuth>['api']['getSession']>>
>

/**
 * Who is asking: the Better Auth session (if any) and the row-level security
 * context to run their queries with (design doc 6.1 step 6). An account that
 * both buys and sells acts as the seller in `area` 'seller', the seller
 * routes, and as the buyer everywhere else.
 *
 * Throws SellerAccountNotReadyError (403) for a seller account whose business
 * has not been set up yet.
 */
export async function getRequestContext(
  headers: Headers,
  area: RequestArea = 'buyer',
  options: { applicants?: boolean } = {},
): Promise<{ session: Session | null; context: RequestContext }> {
  const session = await getAuth().api.getSession({ headers })
  return {
    session,
    context: await resolveRequestContext(
      getDatabase(),
      session?.user ?? null,
      area,
      options,
    ),
  }
}

/**
 * The area a route that both portals use acts in: `?as=seller` from the
 * seller portal, otherwise the buyer. For example, Ravi, who buys and
 * sells, downloads his own sale's invoice with `?as=seller` and his
 * purchase's invoice without it.
 */
export const areaOf = (request: Request): RequestArea =>
  new URL(request.url).searchParams.get('as') === 'seller' ? 'seller' : 'buyer'

/** The signed-in account, acting in `area`, or 401. */
export async function requireSignedIn(
  headers: Headers,
  area: RequestArea = 'buyer',
  options: { applicants?: boolean } = {},
): Promise<{ session: Session; context: RequestContext }> {
  const { session, context } = await getRequestContext(headers, area, options)
  if (!session) throw new NotSignedInError()
  return { session, context }
}

/** A signed-in administrator, or 401 / 403. */
export async function requireAdmin(headers: Headers): Promise<{
  session: Session
  context: Extract<RequestContext, { role: 'admin' }>
}> {
  const { session, context } = await requireSignedIn(headers)
  if (context.role !== 'admin') {
    throw new ForbiddenError('This needs an administrator account')
  }
  return { session, context }
}

/**
 * A signed-in seller whose business is set up and not suspended, or 401 /
 * 403. With `applicants`, also a buyer whose seller application is pending
 * or was rejected, acting for that business: only for the routes an
 * application needs, such as the documents an administrator asked for.
 */
export async function requireSeller(
  headers: Headers,
  options: { applicants?: boolean } = {},
): Promise<{
  session: Session
  context: Extract<RequestContext, { role: 'seller' }>
}> {
  const { session, context } = await requireSignedIn(headers, 'seller', options)
  if (context.role !== 'seller') {
    throw new ForbiddenError('This needs a seller account')
  }
  return { session, context }
}

/** A signed-in buyer, or 401 / 403. */
export async function requireBuyer(headers: Headers): Promise<{
  session: Session
  context: Extract<RequestContext, { role: 'buyer' }>
}> {
  const { session, context } = await requireSignedIn(headers)
  if (context.role !== 'buyer') {
    throw new ForbiddenError('This needs a buyer account')
  }
  return { session, context }
}
