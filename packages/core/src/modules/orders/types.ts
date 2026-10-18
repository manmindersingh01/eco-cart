import { z } from 'zod'
import type { ShippingAddressSnapshot } from '../../db/schema/index.ts'
import { idOf, strictObject, text } from '../../lib/validation.ts'
import type { InvoiceSummary } from '../invoices/types.ts'

/*
 * What buyers, sellers, and administrators send and see for orders after
 * checkout (backend spec step 13).
 */

/** Lines dispatched together in one parcel: `{ lineIds, courierName, ... }`. */
export const dispatchRequest = strictObject({
  lineIds: z
    .array(idOf('an order line'))
    .min(1, 'must list at least one line')
    .max(50, 'must list at most 50 lines')
    .refine(
      (ids) => new Set(ids).size === ids.length,
      'must not list a line twice',
    ),
  courierName: text(100),
  trackingNumber: text(100).regex(
    /^[A-Za-z0-9][A-Za-z0-9 /-]*$/,
    'must be letters and digits, as the courier printed it',
  ),
  trackingUrl: z
    .url({
      protocol: /^https$/,
      error: 'must be an address starting with https://',
    })
    .max(500, 'must be at most 500 characters')
    .nullable()
    .default(null),
})
export type DispatchRequest = z.input<typeof dispatchRequest>

/** A buyer's cancellation; the reason is optional. */
export const buyerCancellation = strictObject({
  reason: text(500).optional(),
})

/** An administrator's cancellation, which always says why. */
export const adminCancellation = strictObject({
  reason: text(500),
})

/** The seller's order queue, one tab at a time. */
export const SELLER_ORDER_TABS = [
  'to_dispatch',
  'dispatched',
  'delivered',
  'cancelled',
] as const
export type SellerOrderTab = (typeof SELLER_ORDER_TABS)[number]

export const ORDER_STATUSES = [
  'pending_payment',
  'confirmed',
  'cancelled',
  'completed',
] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const LINE_STATUSES = [
  'confirmed',
  'dispatched',
  'delivered',
  'cancelled',
  'return_requested',
  'returned',
] as const
export type LineStatus = (typeof LINE_STATUSES)[number]

/** `value` as one of `allowed`, or undefined when it is none of them. */
export const oneOf = <T extends string>(
  allowed: readonly T[],
  value: string | undefined,
): T | undefined => allowed.find((choice) => choice === value)

/**
 * How far an order has got, worked out from its lines, for lists and badges:
 * for example `partly_dispatched` when one seller has sent their parcel and
 * another has not yet.
 */
export type OrderProgress =
  | 'awaiting_payment'
  | 'confirmed'
  | 'partly_dispatched'
  | 'dispatched'
  | 'delivered'
  | 'cancelled'

/**
 * Where the buyer's money stands: `pay_on_delivery` until the courier
 * collects the cash, `refund_due` for a paid order that was cancelled.
 */
export type PaymentState =
  | 'awaiting_payment'
  | 'paid'
  | 'pay_on_delivery'
  | 'refund_due'
  | 'refunded'
  | 'not_charged'

export interface ShipmentView {
  id: string
  courierName: string
  trackingNumber: string
  trackingUrl: string | null
  status: 'dispatched' | 'delivered'
  dispatchedAt: Date
  deliveredAt: Date | null
}

export interface OrderLineView {
  id: string
  lineNumber: number
  productId: string
  variantId: string
  sellerId: string
  /** Null when the seller is no longer shown on EcoKart. */
  sellerName: string | null
  title: string
  sku: string
  options: Record<string, string>
  imageUrl: string | null
  quantity: number
  unitPricePaise: number
  unitMrpPaise: number
  lineTotalPaise: number
  discountSharePaise: number
  gstRateBps: number
  status: LineStatus
  shipment: ShipmentView | null
}

export interface OrderTotals {
  subtotalPaise: number
  discountPaise: number
  deliveryPaise: number
  totalPaise: number
  couponCode: string | null
}

/** One row of the buyer's order list. */
export interface BuyerOrderSummary {
  id: string
  orderNumber: string
  placedAt: Date
  status: OrderStatus
  progress: OrderProgress
  paymentMethod: 'razorpay' | 'cod'
  totalPaise: number
  itemCount: number
  /** The first line, for a picture and a name in the list. */
  firstItem: { title: string; imageUrl: string | null }
}

/** The buyer's own order, with every line and its invoices. */
export interface BuyerOrderView extends OrderTotals {
  id: string
  orderNumber: string
  placedAt: Date
  status: OrderStatus
  progress: OrderProgress
  paymentMethod: 'razorpay' | 'cod'
  paymentState: PaymentState
  paidAt: Date | null
  cancelledAt: Date | null
  cancelReason: string | null
  /** True while no line has been dispatched. */
  canCancel: boolean
  shippingAddress: ShippingAddressSnapshot
  lines: OrderLineView[]
  invoices: InvoiceSummary[]
}

/** One order as a seller sees it: only their own lines. */
export interface SellerOrderView {
  id: string
  orderNumber: string
  placedAt: Date
  status: OrderStatus
  paymentMethod: 'razorpay' | 'cod'
  buyerName: string
  /** The courier needs it. */
  buyerPhone: string
  shippingAddress: ShippingAddressSnapshot
  lines: OrderLineView[]
  /** The seller's own lines' value after their share of any coupon. */
  sellerTotalPaise: number
  invoices: InvoiceSummary[]
}

/** One row of the seller's order queue. */
export type SellerOrderSummary = Omit<SellerOrderView, 'invoices'>

/** One row of the administrators' order list. */
export interface AdminOrderSummary {
  id: string
  orderNumber: string
  placedAt: Date
  status: OrderStatus
  paymentMethod: 'razorpay' | 'cod'
  paymentStatus: string | null
  buyerName: string
  totalPaise: number
  /** A paid order that was cancelled and still needs its refund. */
  needsRefund: boolean
}

export interface OrderEventView {
  id: number
  orderItemId: string | null
  actorRole: string
  eventType: string
  fromStatus: string | null
  toStatus: string | null
  note: string | null
  createdAt: Date
}

export interface PaymentView {
  id: string
  provider: string
  status: string
  amountPaise: number
  method: string | null
  providerOrderId: string | null
  providerPaymentId: string | null
  failureReason: string | null
  createdAt: Date
}

/** Everything about one order, for administrators. */
export interface AdminOrderView extends OrderTotals {
  id: string
  orderNumber: string
  userId: string
  placedAt: Date
  status: OrderStatus
  progress: OrderProgress
  paymentMethod: 'razorpay' | 'cod'
  paymentState: PaymentState
  needsRefund: boolean
  canCancel: boolean
  paidAt: Date | null
  cancelledAt: Date | null
  completedAt: Date | null
  cancelReason: string | null
  buyerName: string
  buyerPhone: string
  buyerEmail: string | null
  shippingAddress: ShippingAddressSnapshot
  lines: OrderLineView[]
  payments: PaymentView[]
  events: OrderEventView[]
  invoices: InvoiceSummary[]
}

/** A buyer's received order line for a product, for verified reviews. */
export interface VerifiedPurchase {
  orderId: string
  orderItemId: string
  deliveredAt: Date | null
}
