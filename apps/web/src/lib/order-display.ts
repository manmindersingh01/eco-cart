import type { LineStatus, OrderProgress, PaymentState } from '@ecokart/core'

/*
 * Plain words for an order's state, shared by the buyer's order pages. They
 * run in the browser too, so they import only types from @ecokart/core.
 */

type Tone = 'neutral' | 'success' | 'warning' | 'danger'

export const PROGRESS: Record<OrderProgress, { label: string; tone: Tone }> = {
  awaiting_payment: { label: 'Waiting for payment', tone: 'warning' },
  confirmed: { label: 'Confirmed', tone: 'neutral' },
  partly_dispatched: { label: 'Partly dispatched', tone: 'neutral' },
  dispatched: { label: 'Dispatched', tone: 'neutral' },
  delivered: { label: 'Delivered', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
}

export const PAYMENT_STATE: Record<PaymentState, string> = {
  awaiting_payment: 'Not paid yet',
  paid: 'Paid online',
  pay_on_delivery: 'Due on delivery',
  refund_due: 'Refund on its way',
  refunded: 'Refunded',
  not_charged: 'Not charged',
}

export const LINE_STATUS: Record<LineStatus, { label: string; tone: Tone }> = {
  confirmed: { label: 'Being packed', tone: 'neutral' },
  dispatched: { label: 'Dispatched', tone: 'neutral' },
  delivered: { label: 'Delivered', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
  return_requested: { label: 'Return requested', tone: 'warning' },
  returned: { label: 'Returned', tone: 'neutral' },
}
