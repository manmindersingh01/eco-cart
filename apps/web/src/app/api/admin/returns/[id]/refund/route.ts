import { recordReturnRefund } from '@ecokart/core'
import { clientIp, handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { getJobQueue } from '@/lib/queue'
import { requireAdmin } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

type Route = RouteContext<'/api/admin/returns/[id]/refund'>

/**
 * Records the refund made for an approved return: `{ "method": "gateway",
 * "amountPaise", "razorpayRefundId" }` or `{ "method": "bank_transfer",
 * "amountPaise", "note": "<bank reference>" }`.
 */
export const POST = handleErrors(async (request: Request, route: Route) => {
  const { context } = await requireAdmin(request.headers)
  const { id } = await route.params
  const input = await readJsonBody(request)
  const refunded = await recordReturnRefund(
    getDatabase(),
    { queue: await getJobQueue(), photos: getStorage() },
    context,
    id,
    input,
    clientIp(request),
  )
  return Response.json({ return: refunded })
})
