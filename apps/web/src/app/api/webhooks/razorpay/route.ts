import { handleRazorpayWebhook, ValidationError } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { getJobQueue } from '@/lib/queue'
import { getRazorpay } from '@/lib/razorpay'

/** Razorpay's deliveries are a few kilobytes; anything far bigger is not one. */
const MAX_BODY_BYTES = 256 * 1024

/**
 * Razorpay's webhook (design doc 6.3 step 6). Razorpay retries every answer
 * other than 2xx, so a delivery that was handled, or was a replay, answers
 * 200; one that could not be processed answers 500 and is tried again.
 */
export const POST = handleErrors(async (request: Request) => {
  const rawBody = await request.text()
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
    throw new ValidationError('The webhook body is too large')
  }
  const outcome = await handleRazorpayWebhook(
    getDatabase(),
    { queue: await getJobQueue(), razorpay: getRazorpay() },
    {
      rawBody,
      signature: request.headers.get('x-razorpay-signature'),
      eventId: request.headers.get('x-razorpay-event-id'),
    },
  )
  return Response.json({ outcome })
})
