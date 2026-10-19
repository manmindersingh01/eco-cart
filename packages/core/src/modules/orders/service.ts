import { asc, eq, sql } from 'drizzle-orm'
import type { Transaction } from '../../db/client.ts'
import {
  orderEvents,
  orderItems,
  orders,
  type ShippingAddressSnapshot,
} from '../../db/schema/index.ts'
import { NotFoundError } from '../../errors.ts'
import type { JobQueue } from '../../lib/queue.ts'
import { giveBackCouponUse } from '../cart/coupons.ts'
import { giveBackStock, lockStock } from '../catalogue/stock.ts'
import { issueInvoices } from '../invoices/service.ts'
import { recordSales } from '../ledger/service.ts'
import { queueOrderPlacedEmail } from '../notifications/service.ts'

/*
 * Orders (design doc 5.7). Checkout creates them (backend spec step 12), and
 * payment confirmation, expiry, and later dispatch and cancellation (step
 * 13) change them through these functions, because this module owns the
 * orders, order_items, and order_events tables.
 */

export type OrderRow = typeof orders.$inferSelect
export type OrderItemRow = typeof orderItems.$inferSelect
export type ActorRole = 'buyer' | 'seller' | 'admin' | 'system'

const kolkataDate = new Intl.DateTimeFormat('en-GB', {
  year: '2-digit',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Kolkata',
})

/**
 * The next order number, for example EK-261018-000123: the date in
 * Asia/Kolkata and a sequence shared by every order.
 */
export async function nextOrderNumber(
  tx: Transaction,
  now: Date,
): Promise<string> {
  const result = await tx.execute<{ value: string }>(
    sql`select nextval('order_number_seq') as value`,
  )
  const [day, month, year] = kolkataDate.format(now).split('/')
  const sequence = result.rows[0]!.value.padStart(6, '0')
  return `EK-${year}${month}${day}-${sequence}`
}

/** An order line as checkout freezes it. */
export type NewOrderItem = Omit<
  typeof orderItems.$inferInsert,
  | 'id'
  | 'orderId'
  | 'shipmentId'
  | 'status'
  | 'lineNumber'
  | 'createdAt'
  | 'updatedAt'
>

export interface NewOrder {
  orderNumber: string
  userId: string
  status: 'pending_payment' | 'confirmed'
  paymentMethod: 'razorpay' | 'cod'
  subtotalPaise: number
  discountPaise: number
  deliveryPaise: number
  taxPaise: number
  totalPaise: number
  couponId: string | null
  couponCode: string | null
  shippingAddress: ShippingAddressSnapshot
  buyerName: string
  buyerPhone: string
  buyerEmail: string | null
  placedAt: Date
  /** In the order the buyer sees them. */
  items: NewOrderItem[]
}

/** Writes an order, its lines numbered from 1, and the `placed` event. */
export async function createOrder(
  tx: Transaction,
  order: NewOrder,
): Promise<{ order: OrderRow; items: OrderItemRow[] }> {
  const { items, ...details } = order
  const [row] = await tx.insert(orders).values(details).returning()
  const lines = await tx
    .insert(orderItems)
    .values(
      items.map((item, index) => ({
        ...item,
        orderId: row!.id,
        lineNumber: index + 1,
      })),
    )
    .returning()
  await recordOrderEvent(tx, {
    orderId: row!.id,
    actorUserId: order.userId,
    actorRole: 'buyer',
    eventType: 'placed',
    toStatus: order.status,
  })
  return {
    order: row!,
    items: lines.toSorted((a, b) => a.lineNumber - b.lineNumber),
  }
}

export async function recordOrderEvent(
  tx: Transaction,
  event: {
    orderId: string
    orderItemId?: string
    actorUserId?: string | null
    actorRole: ActorRole
    eventType: string
    fromStatus?: string
    toStatus?: string
    note?: string
  },
): Promise<void> {
  await tx.insert(orderEvents).values({
    orderId: event.orderId,
    orderItemId: event.orderItemId ?? null,
    actorUserId: event.actorUserId ?? null,
    actorRole: event.actorRole,
    eventType: event.eventType,
    fromStatus: event.fromStatus ?? null,
    toStatus: event.toStatus ?? null,
    note: event.note ?? null,
  })
}

/**
 * Locks an order for a change, or 404. Every change to an order takes this
 * lock first, so a payment confirmation and an expiry (or two
 * confirmations) take turns, and invoices are numbered once.
 */
export async function lockOrder(
  tx: Transaction,
  orderId: string,
): Promise<OrderRow> {
  const [row] = await tx
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .for('update')
  if (!row) throw new NotFoundError('There is no order with that id')
  return row
}

/** The order's lines in the order the buyer sees them. */
export async function orderLines(
  tx: Transaction,
  orderId: string,
): Promise<OrderItemRow[]> {
  return tx
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(
      asc(orderItems.lineNumber),
      asc(orderItems.createdAt),
      asc(orderItems.id),
    )
}

/**
 * What confirming an order sets in motion, in the confirming transaction:
 * the sellers' sale and commission entries, one GST invoice per seller
 * (step 14), and the order placed email. Cash on delivery confirms at
 * checkout; an online payment confirms when Razorpay reports it captured.
 */
export async function onOrderConfirmed(
  tx: Transaction,
  queue: JobQueue,
  order: OrderRow,
  items: OrderItemRow[],
): Promise<void> {
  await recordSales(
    tx,
    order.orderNumber,
    items.map((item) => ({
      orderId: order.id,
      orderItemId: item.id,
      sellerId: item.sellerId,
      title: item.title,
      quantity: item.quantity,
      lineTotalPaise: item.lineTotalPaise,
      discountSharePaise: item.discountSharePaise,
      commissionBps: item.commissionBps,
      commissionPaise: item.commissionPaise,
    })),
  )
  await issueInvoices(tx, queue, {
    orderId: order.id,
    orderNumber: order.orderNumber,
    placedAt: order.placedAt,
    paymentMethod: order.paymentMethod === 'cod' ? 'cod' : 'razorpay',
    buyer: {
      userId: order.userId,
      name: order.buyerName,
      shippingAddress: order.shippingAddress,
    },
    lines: items,
  })
  if (order.buyerEmail) {
    await queueOrderPlacedEmail(
      tx,
      queue,
      { userId: order.userId, email: order.buyerEmail },
      {
        orderNumber: order.orderNumber,
        buyerName: order.buyerName,
        placedAt: order.placedAt.toISOString(),
        paymentMethod: order.paymentMethod === 'cod' ? 'cod' : 'razorpay',
        lines: items.map((item) => ({
          title: item.title,
          options: item.options,
          quantity: item.quantity,
          lineTotalPaise: item.lineTotalPaise,
        })),
        subtotalPaise: order.subtotalPaise,
        discountPaise: order.discountPaise,
        deliveryPaise: order.deliveryPaise,
        totalPaise: order.totalPaise,
        shippingAddress: order.shippingAddress,
      },
    )
  }
}

/**
 * Marks an order waiting for payment as paid and confirmed. The caller holds
 * the order's lock and has checked that it is waiting for payment.
 */
export async function markOrderPaid(
  tx: Transaction,
  order: OrderRow,
  paidAt: Date,
): Promise<OrderRow> {
  const [row] = await tx
    .update(orders)
    .set({ status: 'confirmed', paidAt })
    .where(eq(orders.id, order.id))
    .returning()
  await recordOrderEvent(tx, {
    orderId: order.id,
    actorRole: 'system',
    eventType: 'paid',
    fromStatus: 'pending_payment',
    toStatus: 'confirmed',
  })
  return row!
}

/** Who changed an order, for its events. */
export interface OrderActor {
  role: ActorRole
  userId: string | null
}

/**
 * Cancels a locked order and every line: gives the stock and coupon use
 * back and writes the `cancelled` event. The caller holds the order's lock
 * and has checked that it may be cancelled; money, invoices, and emails are
 * the caller's to handle.
 */
export async function markOrderCancelled(
  tx: Transaction,
  order: OrderRow,
  lines: OrderItemRow[],
  actor: OrderActor,
  reason: string,
): Promise<void> {
  const open = lines.filter((line) => line.status !== 'cancelled')
  await lockStock(
    tx,
    open.map((line) => line.variantId),
  )
  await giveBackStock(tx, open)
  if (order.couponId) await giveBackCouponUse(tx, order.couponId)
  await tx
    .update(orders)
    .set({ status: 'cancelled', cancelledAt: sql`now()`, cancelReason: reason })
    .where(eq(orders.id, order.id))
  await tx
    .update(orderItems)
    .set({ status: 'cancelled' })
    .where(eq(orderItems.orderId, order.id))
  await recordOrderEvent(tx, {
    orderId: order.id,
    actorUserId: actor.userId,
    actorRole: actor.role,
    eventType: 'cancelled',
    fromStatus: order.status,
    toStatus: 'cancelled',
    note: reason,
  })
}

/**
 * Cancels an order that was never paid: online payment could not be
 * started, or the buyer did not pay in time. Gives its stock and coupon use
 * back. Returns false, changing nothing, when the order is no longer
 * waiting for payment, for example because the payment arrived first.
 */
export async function cancelUnpaidOrder(
  tx: Transaction,
  orderId: string,
  reason: string,
): Promise<boolean> {
  const order = await lockOrder(tx, orderId)
  if (order.status !== 'pending_payment') return false
  await markOrderCancelled(
    tx,
    order,
    await orderLines(tx, orderId),
    { role: 'system', userId: null },
    reason,
  )
  return true
}
