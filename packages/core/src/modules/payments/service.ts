import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Database, Transaction } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { paymentEvents, payments } from '../../db/schema/index.ts'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../errors.ts'
import type { JobQueue } from '../../lib/queue.ts'
import {
  toRazorpayPayment,
  type Razorpay,
  type RazorpayPayment,
} from '../../lib/razorpay.ts'
import { parseInput, strictObject } from '../../lib/validation.ts'
import { queuePaymentReceivedEmail } from '../notifications/service.ts'
import {
  lockOrder,
  markOrderPaid,
  onOrderConfirmed,
  orderLines,
  recordOrderEvent,
} from '../orders/service.ts'

/*
 * Payments (design doc 5.8 and 6.3, backend spec step 12). The webhook and
 * the buyer's return from Razorpay's checkout both confirm a payment through
 * `confirmOrderPayment`, which is idempotent, so a payment reported twice
 * (or by both) confirms its order once.
 */

export type PaymentRow = typeof payments.$inferSelect

/** Writes the payment row of a new order. */
export async function createPayment(
  tx: Transaction,
  payment: {
    orderId: string
    provider: 'razorpay' | 'cod'
    amountPaise: number
  },
): Promise<PaymentRow> {
  const [row] = await tx
    .insert(payments)
    .values({
      ...payment,
      // A cash payment's method is known at once; Razorpay reports its own.
      method: payment.provider === 'cod' ? 'cod' : null,
    })
    .returning()
  return row!
}

/** Records the Razorpay order the buyer pays for. */
export async function attachRazorpayOrder(
  tx: Transaction,
  paymentId: string,
  razorpayOrderId: string,
): Promise<void> {
  await tx
    .update(payments)
    .set({ providerOrderId: razorpayOrderId })
    .where(eq(payments.id, paymentId))
}

/** Marks the payment of an order that was never paid as failed. */
export async function failPayment(
  tx: Transaction,
  orderId: string,
  reason: string,
): Promise<void> {
  await tx
    .update(payments)
    .set({ status: 'failed', failureReason: reason })
    .where(and(eq(payments.orderId, orderId), eq(payments.status, 'created')))
}

/** What happened to a payment Razorpay reported captured. */
export type ConfirmationOutcome =
  /** The order is now paid and confirmed. */
  | 'confirmed'
  /** The same payment was confirmed before; nothing changed. */
  | 'already_confirmed'
  /**
   * The money arrived but the order was already cancelled (it expired) or
   * paid by another payment: recorded, with an order event asking an
   * administrator to refund it (design doc 6.3 step 8).
   */
  | 'needs_refund'
  /** No order of ours has this Razorpay order. */
  | 'unknown_order'
  /**
   * The amount is not the order's total, which Razorpay should never allow:
   * nothing is confirmed, and an order event asks an administrator to look.
   */
  | 'amount_mismatch'

/**
 * Confirms the order a captured Razorpay payment pays for, in `tx`, which
 * runs as `system`: marks the payment captured and the order confirmed,
 * writes the ledger entries, issues the invoices, and queues the order and
 * payment emails. The order's row lock is taken first, as every change to an
 * order does, so two reports of one payment take turns, and the second finds
 * the payment captured and changes nothing.
 */
export async function confirmOrderPayment(
  tx: Transaction,
  queue: JobQueue,
  payment: RazorpayPayment,
): Promise<ConfirmationOutcome> {
  if (payment.status !== 'captured') {
    throw new Error(`Payment ${payment.id} is ${payment.status}, not captured`)
  }
  if (!payment.orderId) return 'unknown_order'
  const [found] = await tx
    .select({ id: payments.id, orderId: payments.orderId })
    .from(payments)
    .where(eq(payments.providerOrderId, payment.orderId))
  if (!found) return 'unknown_order'

  const order = await lockOrder(tx, found.orderId)
  const [row] = await tx
    .select()
    .from(payments)
    .where(eq(payments.id, found.id))
    .for('update')
  const current = row!
  if (current.status === 'captured') {
    if (current.providerPaymentId === payment.id) return 'already_confirmed'
    await recordOrderEvent(tx, {
      orderId: order.id,
      actorRole: 'system',
      eventType: 'payment_needs_refund',
      note: `Razorpay payment ${payment.id} of ${payment.amountPaise} paise arrived after the order was already paid by ${current.providerPaymentId}; refund it`,
    })
    return 'needs_refund'
  }
  if (
    payment.amountPaise !== current.amountPaise ||
    payment.currency !== 'INR'
  ) {
    await recordOrderEvent(tx, {
      orderId: order.id,
      actorRole: 'system',
      eventType: 'payment_amount_mismatch',
      note: `Razorpay payment ${payment.id} is for ${payment.amountPaise} ${payment.currency}, but the order needs ${current.amountPaise} INR; check it in the Razorpay dashboard`,
    })
    return 'amount_mismatch'
  }

  await tx
    .update(payments)
    .set({
      status: 'captured',
      providerPaymentId: payment.id,
      method: payment.method,
      failureReason: null,
      raw: payment,
    })
    .where(eq(payments.id, current.id))

  if (order.status !== 'pending_payment') {
    await recordOrderEvent(tx, {
      orderId: order.id,
      actorRole: 'system',
      eventType: 'payment_needs_refund',
      note: `Razorpay payment ${payment.id} was captured after the order was ${order.status}; refund it`,
    })
    return 'needs_refund'
  }

  const paidAt = new Date()
  const confirmed = await markOrderPaid(tx, order, paidAt)
  await onOrderConfirmed(tx, queue, confirmed, await orderLines(tx, order.id))
  if (confirmed.buyerEmail) {
    await queuePaymentReceivedEmail(
      tx,
      queue,
      { userId: confirmed.userId, email: confirmed.buyerEmail },
      {
        orderNumber: confirmed.orderNumber,
        amountPaise: payment.amountPaise,
        method: payment.method,
        paidAt: paidAt.toISOString(),
      },
    )
  }
  return 'confirmed'
}

const SYSTEM: RequestContext = { role: 'system' }

const webhookShape = z.object({
  event: z.string(),
  payload: z
    .object({ payment: z.object({ entity: z.unknown() }).optional() })
    .loose(),
})

export interface WebhookDelivery {
  /** The body exactly as received; the signature covers these bytes. */
  rawBody: string
  /** The X-Razorpay-Signature header. */
  signature: string | null
  /** The X-Razorpay-Event-Id header, unique per event. */
  eventId: string | null
}

export type WebhookOutcome =
  ConfirmationOutcome | 'replay' | 'ignored' | 'failure_recorded'

/** Outcomes an administrator should look at, kept on the stored event. */
const WEBHOOK_PROBLEMS: Partial<Record<WebhookOutcome, string>> = {
  unknown_order: 'No order has this Razorpay order',
  needs_refund: 'The payment needs a refund; see the order events',
  amount_mismatch: 'The amount is not the order total; see the order events',
}

/**
 * Handles one Razorpay webhook delivery (design doc 6.3 step 6). The
 * signature is checked before anything in the body is read. The event is
 * stored and processed in one transaction, with `ON CONFLICT DO NOTHING` on
 * its id, so a replay changes nothing, and a delivery whose processing
 * failed leaves no trace, so Razorpay's retry processes it again.
 */
export async function handleRazorpayWebhook(
  db: Database,
  deps: { queue: JobQueue; razorpay: Razorpay | null },
  delivery: WebhookDelivery,
): Promise<WebhookOutcome> {
  if (!deps.razorpay) {
    throw new NotFoundError('Online payment is not switched on')
  }
  if (
    !delivery.signature ||
    !deps.razorpay.webhookSignatureIsValid(delivery.rawBody, delivery.signature)
  ) {
    throw new ValidationError('The webhook signature is not valid')
  }
  if (!delivery.eventId) {
    throw new ValidationError('The webhook has no event id')
  }
  let json: unknown
  try {
    json = JSON.parse(delivery.rawBody)
  } catch {
    throw new ValidationError('The webhook body is not JSON')
  }
  const parsedBody = webhookShape.safeParse(json)
  if (!parsedBody.success) {
    throw new ValidationError('The webhook body is not a Razorpay event')
  }
  const body = parsedBody.data
  const eventId = delivery.eventId

  return withContext(db, SYSTEM, async (tx) => {
    const [stored] = await tx
      .insert(paymentEvents)
      .values({
        provider: 'razorpay',
        eventId,
        eventType: body.event,
        payload: body,
        signatureValid: true,
      })
      .onConflictDoNothing()
      .returning({ id: paymentEvents.id })
    if (!stored) return 'replay'

    let outcome: WebhookOutcome = 'ignored'
    const entity = body.payload.payment?.entity
    if (
      (body.event === 'payment.captured' || body.event === 'order.paid') &&
      entity !== undefined
    ) {
      outcome = await confirmOrderPayment(
        tx,
        deps.queue,
        toRazorpayPayment(entity),
      )
    } else if (body.event === 'payment.failed' && entity !== undefined) {
      await recordFailedAttempt(tx, toRazorpayPayment(entity))
      outcome = 'failure_recorded'
    }
    await tx
      .update(paymentEvents)
      .set({
        processedAt: sql`now()`,
        error: WEBHOOK_PROBLEMS[outcome] ?? null,
      })
      .where(eq(paymentEvents.id, stored.id))
    return outcome
  })
}

/**
 * Notes why an attempt to pay failed, for example a declined card. The order
 * keeps waiting: the buyer may try again on the same Razorpay order until it
 * expires.
 */
async function recordFailedAttempt(
  tx: Transaction,
  payment: RazorpayPayment,
): Promise<void> {
  if (!payment.orderId) return
  await tx
    .update(payments)
    .set({
      failureReason: payment.errorDescription ?? 'The payment failed',
      raw: payment,
    })
    .where(
      and(
        eq(payments.providerOrderId, payment.orderId),
        eq(payments.status, 'created'),
      ),
    )
}

const checkoutReturn = strictObject({
  razorpayOrderId: z.string().min(1).max(100),
  razorpayPaymentId: z.string().min(1).max(100),
  razorpaySignature: z.string().min(1).max(200),
})

export interface PaymentResult {
  orderId: string
  orderNumber: string
  /**
   * confirmed once paid; pending while Razorpay is still finishing; cancelled
   * when the payment came after the order expired (it will be refunded).
   */
  status: 'confirmed' | 'pending' | 'cancelled'
}

/**
 * The buyer's browser coming back from Razorpay's checkout with the payment
 * it made (design doc 6.3 step 6). The signature proves the ids came from
 * Razorpay; as a safety net the payment is also read back from Razorpay,
 * and only a captured payment confirms the order. The webhook confirms the
 * same payment too, whichever arrives first.
 */
export async function confirmCheckoutPayment(
  db: Database,
  deps: { queue: JobQueue; razorpay: Razorpay | null },
  context: RequestContext,
  input: unknown,
): Promise<PaymentResult> {
  if (context.role !== 'buyer') {
    throw new ForbiddenError('This needs a buyer account')
  }
  const razorpay = deps.razorpay
  if (!razorpay) throw new NotFoundError('Online payment is not switched on')
  const given = parseInput(
    checkoutReturn,
    input,
    'Those payment details are not valid',
  )
  if (
    !razorpay.checkoutSignatureIsValid({
      orderId: given.razorpayOrderId,
      paymentId: given.razorpayPaymentId,
      signature: given.razorpaySignature,
    })
  ) {
    throw new ValidationError('The payment signature is not valid')
  }
  // As the buyer, so row-level security also hides other buyers' payments.
  const order = await withContext(db, context, async (tx) => {
    const [row] = await tx
      .select({ orderId: payments.orderId })
      .from(payments)
      .where(eq(payments.providerOrderId, given.razorpayOrderId))
    return row ?? null
  })
  if (!order) throw new NotFoundError('There is no order with that payment')

  const payment = await razorpay.fetchPayment(given.razorpayPaymentId)
  if (payment.orderId !== given.razorpayOrderId) {
    throw new ValidationError('That payment is for a different order')
  }
  if (payment.status === 'failed') {
    throw new ConflictError(
      payment.errorDescription ?? 'The payment failed; please try again',
    )
  }
  return withContext(db, SYSTEM, async (tx) => {
    if (payment.status === 'captured') {
      await confirmOrderPayment(tx, deps.queue, payment)
    }
    const current = await lockOrder(tx, order.orderId)
    return {
      orderId: current.id,
      orderNumber: current.orderNumber,
      status:
        current.status === 'pending_payment'
          ? 'pending'
          : current.status === 'cancelled'
            ? 'cancelled'
            : 'confirmed',
    }
  })
}
