import { getReturn, withContext } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireBuyer } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

type Route = RouteContext<'/api/account/returns/[id]'>

/** One of the buyer's returns. */
export const GET = handleErrors(async (request: Request, route: Route) => {
  const { context } = await requireBuyer(request.headers)
  const { id } = await route.params
  const found = await withContext(getDatabase(), context, (tx) =>
    getReturn(tx, context, getStorage(), id),
  )
  return Response.json({ return: found })
})
