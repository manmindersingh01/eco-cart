import { suspendSeller } from '@ecokart/core'
import { handleErrors, readJsonBody } from '@/lib/api'
import { requireAdmin } from '@/lib/request-context'
import { getSellerServices } from '@/lib/sellers'

/**
 * `{ "reason": "..." }`. An owner who only sells is also signed out
 * everywhere; one who also buys keeps shopping.
 */
export const POST = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/sellers/[id]/suspend'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    const seller = await suspendSeller(
      getSellerServices(),
      context,
      id,
      await readJsonBody(request),
    )
    return Response.json({ seller })
  },
)
