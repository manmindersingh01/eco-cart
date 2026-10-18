import { checkoutOptions, placeOrder, withContext } from '@ecokart/core'
import { handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { getJobQueue } from '@/lib/queue'
import { getRazorpay } from '@/lib/razorpay'
import { requireBuyer } from '@/lib/request-context'

/** The ways the buyer can pay right now. */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireBuyer(request.headers)
  const options = await withContext(getDatabase(), context, (tx) =>
    checkoutOptions(tx, getRazorpay()),
  )
  return Response.json(options)
})

/**
 * Places an order from the buyer's cart (design doc 6.3):
 * `{ "addressId", "paymentMethod": "razorpay" | "cod", "expectedTotalPaise" }`.
 * For online payment the answer carries what the browser opens Razorpay's
 * checkout with.
 */
export const POST = handleErrors(async (request: Request) => {
  const { session, context } = await requireBuyer(request.headers)
  const input = await readJsonBody(request)
  const { user } = session
  const placed = await placeOrder(
    getDatabase(),
    { queue: await getJobQueue(), razorpay: getRazorpay() },
    context,
    {
      name: user.name,
      // Phone-only accounts carry a placeholder address nobody should see.
      email: user.email.endsWith('.invalid') ? null : user.email,
      phoneNumber: user.phoneNumber ?? null,
    },
    input,
  )
  return Response.json(placed, { status: 201 })
})
