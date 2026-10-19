import { getReturn, withContext } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

type Route = RouteContext<'/api/admin/returns/[id]'>

/** One return, with the most its refund may be. */
export const GET = handleErrors(async (request: Request, route: Route) => {
  const { context } = await requireAdmin(request.headers)
  const { id } = await route.params
  const found = await withContext(getDatabase(), context, (tx) =>
    getReturn(tx, context, getStorage(), id),
  )
  return Response.json({ return: found })
})
