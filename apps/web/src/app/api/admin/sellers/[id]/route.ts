import { getSeller, updateSeller } from '@ecokart/core'
import { handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'
import { getSellerServices } from '@/lib/sellers'

/** One seller with its owner's account. */
export const GET = handleErrors(
  async (request: Request, route: RouteContext<'/api/admin/sellers/[id]'>) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    return Response.json({
      seller: await getSeller(getSellerServices(), context, id),
    })
  },
)

/** Changes business details. */
export const PATCH = handleErrors(
  async (request: Request, route: RouteContext<'/api/admin/sellers/[id]'>) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    const seller = await updateSeller(
      getDatabase(),
      context,
      id,
      await readJsonBody(request),
    )
    return Response.json({ seller })
  },
)
