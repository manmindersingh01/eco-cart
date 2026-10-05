import {
  ForbiddenError,
  NotSignedInError,
  resolveRequestContext,
  type RequestContext,
} from '@ecokart/core'
import { getAuth } from './auth'
import { getDatabase } from './db'

export type Session = NonNullable<
  Awaited<ReturnType<ReturnType<typeof getAuth>['api']['getSession']>>
>

/**
 * Who is asking: the Better Auth session (if any) and the row-level security
 * context to run their queries with (design doc 6.1 step 6).
 *
 * Throws SellerAccountNotReadyError (403) for a seller account whose business
 * has not been set up yet.
 */
export async function getRequestContext(
  headers: Headers,
): Promise<{ session: Session | null; context: RequestContext }> {
  const session = await getAuth().api.getSession({ headers })
  return {
    session,
    context: await resolveRequestContext(getDatabase(), session?.user ?? null),
  }
}

/** The signed-in account, or 401. */
export async function requireSignedIn(
  headers: Headers,
): Promise<{ session: Session; context: RequestContext }> {
  const { session, context } = await getRequestContext(headers)
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
