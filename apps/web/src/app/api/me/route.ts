import { SellerAccountNotReadyError } from '@ecokart/core'
import { getRequestContext } from '@/lib/request-context'

/**
 * The signed-in account, for the storefront header and the two portals.
 * 401 when signed out; 403 for a seller account that is not set up yet.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { session, context } = await getRequestContext(request.headers)
    if (!session) {
      return Response.json({ error: 'Not signed in' }, { status: 401 })
    }
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
  } catch (error) {
    if (error instanceof SellerAccountNotReadyError) {
      return Response.json({ error: error.message }, { status: 403 })
    }
    throw error
  }
}
