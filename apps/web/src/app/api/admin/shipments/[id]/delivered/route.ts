import { markShipmentDelivered } from '@ecokart/core'
import { clientIp, handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

type Route = RouteContext<'/api/admin/shipments/[id]/delivered'>

/** Marks a parcel delivered for its seller, for example a suspended one. */
export const POST = handleErrors(async (request: Request, route: Route) => {
  const { context } = await requireAdmin(request.headers)
  const { id } = await route.params
  const shipment = await markShipmentDelivered(
    getDatabase(),
    context,
    id,
    clientIp(request),
  )
  return Response.json({ shipment })
})
