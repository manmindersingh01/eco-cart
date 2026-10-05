import { approveSeller } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

export const POST = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/sellers/[id]/approve'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    return Response.json({
      seller: await approveSeller(getDatabase(), context, id),
    })
  },
)
