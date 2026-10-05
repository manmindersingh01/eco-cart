import { reinstateSeller } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { requireAdmin } from '@/lib/request-context'
import { getSellerServices } from '@/lib/sellers'

export const POST = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/sellers/[id]/reinstate'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    return Response.json({
      seller: await reinstateSeller(getSellerServices(), context, id),
    })
  },
)
