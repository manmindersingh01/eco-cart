import { cancelOwnOrder } from '@ecokart/core'
import { handleErrors, readOptionalJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { getJobQueue } from '@/lib/queue'
import { requireBuyer } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

type Route = RouteContext<'/api/account/orders/[id]/cancel'>

/**
 * The buyer cancels their order before anything in it is dispatched:
 * `{ "reason"?: "Ordered the wrong size" }`.
 */
export const POST = handleErrors(async (request: Request, route: Route) => {
  const { context } = await requireBuyer(request.headers)
  const { id } = await route.params
  const input = await readOptionalJsonBody(request)
  const order = await cancelOwnOrder(
    getDatabase(),
    { queue: await getJobQueue(), photos: getStorage() },
    context,
    id,
    input,
  )
  return Response.json({ order })
})
