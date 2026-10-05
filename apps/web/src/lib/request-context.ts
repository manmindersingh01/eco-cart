import { resolveRequestContext, type RequestContext } from '@ecokart/core'
import { getAuth } from './auth'
import { getDatabase } from './db'

export type Session = NonNullable<
  Awaited<ReturnType<ReturnType<typeof getAuth>['api']['getSession']>>
>

/**
 * Who is asking: the Better Auth session (if any) and the row-level security
 * context to run their queries with (design doc 6.1 step 5).
 *
 * Throws SellerAccountNotReadyError for a seller account whose business has
 * not been set up yet.
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
