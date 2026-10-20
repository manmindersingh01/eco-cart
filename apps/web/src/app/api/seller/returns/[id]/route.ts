import { getReturn, withContext } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireSeller } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

type Route = RouteContext<'/api/seller/returns/[id]'>

/** One return of the seller's lines. */
export const GET = handleErrors(async (request: Request, route: Route) => {
  const { context } = await requireSeller(request.headers)
  const { id } = await route.params
  const found = await withContext(getDatabase(), context, (tx) =>
    getReturn(tx, context, getStorage(), id),
  )
  return Response.json({ return: found })
})
