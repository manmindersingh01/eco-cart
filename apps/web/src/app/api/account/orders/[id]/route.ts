import { getBuyerOrder, withContext } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireBuyer } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

type Route = RouteContext<'/api/account/orders/[id]'>

/** One of the buyer's orders, with its parcels and invoices. */
export const GET = handleErrors(async (request: Request, route: Route) => {
  const { context } = await requireBuyer(request.headers)
  const { id } = await route.params
  const order = await withContext(getDatabase(), context, (tx) =>
    getBuyerOrder(tx, context, getStorage(), id),
  )
  return Response.json({ order })
})
