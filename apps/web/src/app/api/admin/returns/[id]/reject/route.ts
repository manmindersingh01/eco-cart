import { rejectReturn } from '@ecokart/core'
import { clientIp, handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

type Route = RouteContext<'/api/admin/returns/[id]/reject'>

/** Turns a return down, saying why: `{ "note": "..." }`. */
export const POST = handleErrors(async (request: Request, route: Route) => {
  const { context } = await requireAdmin(request.headers)
  const { id } = await route.params
  const input = await readJsonBody(request)
  const decided = await rejectReturn(
    getDatabase(),
    { photos: getStorage() },
    context,
    id,
    input,
    clientIp(request),
  )
  return Response.json({ return: decided })
})
