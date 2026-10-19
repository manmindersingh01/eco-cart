import { getSellerOrder, withContext } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireSeller } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

type Route = RouteContext<'/api/seller/orders/[id]'>

/** One order with the seller's own lines and the delivery address. */
export const GET = handleErrors(async (request: Request, route: Route) => {
  const { context } = await requireSeller(request.headers)
  const { id } = await route.params
  const order = await withContext(getDatabase(), context, (tx) =>
    getSellerOrder(tx, context, getStorage(), id),
  )
  return Response.json({ order })
})
