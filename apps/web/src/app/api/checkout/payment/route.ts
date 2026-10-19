import { confirmCheckoutPayment } from '@ecokart/core'
import { handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { getJobQueue } from '@/lib/queue'
import { getRazorpay } from '@/lib/razorpay'
import { requireBuyer } from '@/lib/request-context'

/**
 * The browser coming back from Razorpay's checkout (design doc 6.3 step 6):
 * `{ "razorpayOrderId", "razorpayPaymentId", "razorpaySignature" }`, as
 * Razorpay hands them to the page.
 */
export const POST = handleErrors(async (request: Request) => {
  const { context } = await requireBuyer(request.headers)
  const input = await readJsonBody(request)
  const payment = await confirmCheckoutPayment(
    getDatabase(),
    { queue: await getJobQueue(), razorpay: getRazorpay() },
    context,
    input,
  )
  return Response.json(payment)
})
