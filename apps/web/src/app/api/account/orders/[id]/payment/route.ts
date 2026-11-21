import { resumeOnlinePayment } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { getRazorpay } from '@/lib/razorpay'
import { requireBuyer } from '@/lib/request-context'

type Route = RouteContext<'/api/account/orders/[id]/payment'>

/**
 * What the browser opens Razorpay's checkout with again, for the buyer's
 * order still waiting for its online payment; 409 once it is paid,
 * cancelled, or expired. The answer has the same shape as checkout's
 * `payment`, and the browser confirms it at /api/checkout/payment.
 */
export const GET = handleErrors(async (request: Request, route: Route) => {
  const { context } = await requireBuyer(request.headers)
  const { id } = await route.params
  const payment = await resumeOnlinePayment(
    getDatabase(),
    getRazorpay(),
    context,
    id,
  )
  return Response.json({ payment })
})
