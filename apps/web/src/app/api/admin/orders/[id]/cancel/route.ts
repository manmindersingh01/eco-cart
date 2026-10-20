import { cancelOrderAsAdmin } from '@ecokart/core'
import { clientIp, handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { getJobQueue } from '@/lib/queue'
import { requireAdmin } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

type Route = RouteContext<'/api/admin/orders/[id]/cancel'>

/**
 * Cancels an order before dispatch on the buyer's behalf:
 * `{ "reason": "The seller cannot supply it" }`.
 */
export const POST = handleErrors(async (request: Request, route: Route) => {
  const { context } = await requireAdmin(request.headers)
  const { id } = await route.params
  const input = await readJsonBody(request)
  const order = await cancelOrderAsAdmin(
    getDatabase(),
    { queue: await getJobQueue(), photos: getStorage() },
    context,
    id,
    input,
    clientIp(request),
  )
  return Response.json({ order })
})
