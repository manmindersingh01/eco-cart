import { handleErrors } from '@/lib/api'
import { requireSignedIn } from '@/lib/request-context'

/**
 * The signed-in account, for the storefront header and the two portals.
 * 401 when signed out; 403 for a seller account that is not set up yet.
 */
export const GET = handleErrors(async (request: Request) => {
  const { session, context } = await requireSignedIn(request.headers)
  const { user } = session
  return Response.json({
    id: user.id,
    name: user.name,
    // Phone-only accounts carry a placeholder address nobody should see.
    email: user.email.endsWith('.invalid') ? null : user.email,
    phoneNumber: user.phoneNumber ?? null,
    role: context.role,
    sellerId: context.role === 'seller' ? context.sellerId : null,
  })
})
