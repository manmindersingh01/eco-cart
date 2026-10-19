import { dispatchLines } from '@ecokart/core'
import { handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { getJobQueue } from '@/lib/queue'
import { requireSeller } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

type Route = RouteContext<'/api/seller/orders/[id]/shipments'>

/**
 * Dispatches some of the seller's lines in one parcel: `{ "lineIds": [...],
 * "courierName": "Delhivery", "trackingNumber": "...", "trackingUrl"?: "https://..." }`.
 */
export const POST = handleErrors(async (request: Request, route: Route) => {
  const { context } = await requireSeller(request.headers)
  const { id } = await route.params
  const input = await readJsonBody(request)
  const order = await dispatchLines(
    getDatabase(),
    { queue: await getJobQueue(), photos: getStorage() },
    context,
    id,
    input,
  )
  return Response.json({ order }, { status: 201 })
})
