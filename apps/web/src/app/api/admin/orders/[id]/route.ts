import { getAdminOrder, withContext } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

type Route = RouteContext<'/api/admin/orders/[id]'>

/** Everything about one order: lines, parcels, payments, events, invoices. */
export const GET = handleErrors(async (request: Request, route: Route) => {
  const { context } = await requireAdmin(request.headers)
  const { id } = await route.params
  const order = await withContext(getDatabase(), context, (tx) =>
    getAdminOrder(tx, context, getStorage(), id),
  )
  return Response.json({ order })
})
