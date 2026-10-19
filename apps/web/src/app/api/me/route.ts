import { isPlaceholderEmail, rolesOf } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { requireSignedIn } from '@/lib/request-context'

/**
 * The signed-in account, for the storefront header and the two portals.
 * `role` is how this request acts, the buyer for an account that also
 * sells; `roles` is everything the account may be, so the header can offer
 * the seller portal to an approved applicant. 401 when signed out; 403 for
 * a seller account that is not set up yet.
 */
export const GET = handleErrors(async (request: Request) => {
  const { session, context } = await requireSignedIn(request.headers)
  const { user } = session
  return Response.json({
    id: user.id,
    name: user.name,
    // Phone-only accounts carry a placeholder address nobody should see.
    email: isPlaceholderEmail(user.email) ? null : user.email,
    phoneNumber: user.phoneNumber ?? null,
    role: context.role,
    roles: rolesOf(user.role),
    sellerId: context.role === 'seller' ? context.sellerId : null,
  })
})
