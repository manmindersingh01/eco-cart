import { markShipmentDelivered } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireSeller } from '@/lib/request-context'

type Route = RouteContext<'/api/seller/shipments/[id]/delivered'>

/** Marks one of the seller's parcels delivered. */
export const POST = handleErrors(async (request: Request, route: Route) => {
  const { context } = await requireSeller(request.headers)
  const { id } = await route.params
  const shipment = await markShipmentDelivered(getDatabase(), context, id)
  return Response.json({ shipment })
})
