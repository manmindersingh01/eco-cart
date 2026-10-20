import { approveReturn } from '@ecokart/core'
import { clientIp, handleErrors, readOptionalJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

type Route = RouteContext<'/api/admin/returns/[id]/approve'>

/** Accepts a return: `{ "note"?: "..." }`, shown to the buyer and seller. */
export const POST = handleErrors(async (request: Request, route: Route) => {
  const { context } = await requireAdmin(request.headers)
  const { id } = await route.params
  const input = await readOptionalJsonBody(request)
  const decided = await approveReturn(
    getDatabase(),
    { photos: getStorage() },
    context,
    id,
    input,
    clientIp(request),
  )
  return Response.json({ return: decided })
})
