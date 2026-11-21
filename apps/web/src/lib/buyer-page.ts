import type { RequestContext } from '@ecokart/core'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { Session } from './request-context'
import { getRequestContext } from './request-context'

export type BuyerContext = Extract<RequestContext, { role: 'buyer' }>

/**
 * The signed-in buyer of a personal storefront page (orders, addresses,
 * checkout), or a redirect: to sign in and come back to `returnTo`, or away
 * for an administrator, who shops with a separate buyer account. An account
 * that buys and sells acts as the buyer here.
 */
export async function requireBuyerPage(
  returnTo: `/${string}`,
): Promise<{ session: Session; context: BuyerContext }> {
  const { session, context } = await getRequestContext(await headers())
  if (!session) {
    redirect(`/sign-in?${new URLSearchParams({ returnTo }).toString()}`)
  }
  if (context.role !== 'buyer') redirect('/access-denied?area=buyer')
  return { session, context }
}
