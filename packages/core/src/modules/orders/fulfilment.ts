import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Database, Transaction } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { orderItems, orders, shipments } from '../../db/schema/index.ts'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../errors.ts'
import type { JobQueue } from '../../lib/queue.ts'
import { isUuid, parseInput } from '../../lib/validation.ts'
import { recordAuditEntry } from '../audit/service.ts'
import type { PhotoAddresses } from '../catalogue/products.ts'
import { cancelInvoices } from '../invoices/service.ts'
import { reverseSales } from '../ledger/service.ts'
import {
  queueCancelledEmail,
  queueDispatchedEmail,
} from '../notifications/service.ts'
import {
  captureCashPayment,
  failPayment,
  paymentsOfOrder,
} from '../payments/service.ts'
import {
  lockOrder,
  markOrderCancelled,
  orderLines,
  recordOrderEvent,
  type OrderActor,
  type OrderItemRow,
  type OrderRow,
} from './service.ts'
import {
  adminCancellation,
  buyerCancellation,
  dispatchRequest,
  type AdminOrderView,
  type BuyerOrderView,
  type SellerOrderView,
  type ShipmentView,
} from './types.ts'
import {
  canBeCancelled,
  getAdminOrder,
  getBuyerOrder,
  getSellerOrder,
} from './views.ts'

/*
 * What happens to an order after checkout (design doc 6.4, backend spec
 * step 13): sellers dispatch their lines and mark them delivered, and the
 * buyer or an administrator cancels an order before anything is dispatched.
 *
 * Each change runs as `system`, after the checks here, because it touches
 * several parties' data at once (the buyer's order, the seller's lines,
 * stock, the ledger, invoices, and payments). Each takes the order's row
 * lock first, so a dispatch and a cancellation of the same order take
 * turns: whichever comes second sees what the first did.
 */

interface Deps {
  queue: JobQueue
  photos: PhotoAddresses
}

const STATUS_WORDS: Record<string, string> = {
  pending_payment: 'still waiting for payment',
  cancelled: 'cancelled',
  completed: 'already completed',
}

const missingOrder = () => new NotFoundError('There is no order with that id')
const missingShipment = () =>
  new NotFoundError('There is no shipment with that id')

const systemFor = (context: RequestContext): RequestContext => ({
  role: 'system',
  userId: 'userId' in context ? context.userId : undefined,
})

const shipped = (line: OrderItemRow) => ({
  title: line.title,
  options: line.options,
  quantity: line.quantity,
})

/* Dispatch. */

/**
 * The seller sends some of their lines of an order in one parcel:
 * `{ lineIds, courierName, trackingNumber, trackingUrl }`. Writes the
 * shipment, marks the lines dispatched, and emails the buyer.
 */
export async function dispatchLines(
  db: Database,
  deps: Deps,
  context: RequestContext,
  orderId: string,
  input: unknown,
): Promise<SellerOrderView> {
  if (context.role !== 'seller') {
    throw new ForbiddenError('This needs a seller account')
  }
  const request = parseInput(
    dispatchRequest,
    input,
    'Those dispatch details are not valid',
  )
  if (!isUuid(orderId)) throw missingOrder()
  const { sellerId, userId } = context

  await withContext(db, systemFor(context), async (tx) => {
    const order = await lockOrder(tx, orderId)
    const lines = await orderLines(tx, orderId)
    const own = lines.filter((line) => line.sellerId === sellerId)
    if (own.length === 0) {
      throw missingOrder()
    }
    if (order.status !== 'confirmed') {
      throw new ConflictError(
        `Order ${order.orderNumber} is ${STATUS_WORDS[order.status] ?? order.status}, so nothing in it can be dispatched`,
      )
    }
    const byId = new Map(own.map((line) => [line.id, line]))
    const parcel = request.lineIds.flatMap((id) => byId.get(id) ?? [])
    if (parcel.length !== request.lineIds.length) {
      throw new ValidationError('Those dispatch details are not valid', [
        'lineIds must be your own lines of this order',
      ])
    }
    const notReady = parcel.filter((line) => line.status !== 'confirmed')
    if (notReady.length > 0) {
      throw new ConflictError(
        notReady
          .map((line) => `${line.title} is already ${line.status}`)
          .join('; '),
      )
    }

    const [shipment] = await tx
      .insert(shipments)
      .values({
        orderId,
        sellerId,
        courierName: request.courierName,
        trackingNumber: request.trackingNumber,
        trackingUrl: request.trackingUrl,
        createdBy: userId,
      })
      .returning()
    await tx
      .update(orderItems)
      .set({ status: 'dispatched', shipmentId: shipment!.id })
      .where(
        inArray(
          orderItems.id,
          parcel.map((line) => line.id),
        ),
      )
    for (const line of parcel) {
      await recordOrderEvent(tx, {
        orderId,
        orderItemId: line.id,
        actorUserId: userId,
        actorRole: 'seller',
        eventType: 'dispatched',
        fromStatus: 'confirmed',
        toStatus: 'dispatched',
        note: `${request.courierName} ${request.trackingNumber}`,
      })
    }
    if (order.buyerEmail) {
      const sent = new Set(parcel.map((line) => line.id))
      await queueDispatchedEmail(
        tx,
        deps.queue,
        { userId: order.userId, email: order.buyerEmail },
        {
          orderNumber: order.orderNumber,
          buyerName: order.buyerName,
          lines: parcel.map(shipped),
          courierName: request.courierName,
          trackingNumber: request.trackingNumber,
          trackingUrl: request.trackingUrl,
          wholeOrder: lines.every(
            (line) => line.status !== 'confirmed' || sent.has(line.id),
          ),
          firstParcel: lines.every(
            (line) =>
              line.status === 'confirmed' || line.status === 'cancelled',
          ),
        },
      )
    }
  })
  return withContext(db, context, (tx) =>
    getSellerOrder(tx, context, deps.photos, orderId),
  )
}

/* Delivery. */

/**
 * Marks a parcel delivered, by its seller or an administrator. When every
 * line of the order is then delivered (or cancelled), the order is
 * completed, and for cash on delivery the cash is recorded as collected:
 * for an order from several sellers, once the last parcel arrives. Marking
 * a delivered parcel again changes nothing.
 */
export async function markShipmentDelivered(
  db: Database,
  context: RequestContext,
  shipmentId: string,
  ip: string | null = null,
): Promise<ShipmentView> {
  if (context.role !== 'seller' && context.role !== 'admin') {
    throw new ForbiddenError(
      'Only the seller or an administrator can mark a parcel delivered',
    )
  }
  if (!isUuid(shipmentId)) throw missingShipment()

  return withContext(db, systemFor(context), async (tx) => {
    const [found] = await tx
      .select({ orderId: shipments.orderId, sellerId: shipments.sellerId })
      .from(shipments)
      .where(eq(shipments.id, shipmentId))
    if (
      !found ||
      (context.role === 'seller' && found.sellerId !== context.sellerId)
    ) {
      throw missingShipment()
    }
    const order = await lockOrder(tx, found.orderId)
    const [parcel] = await tx
      .select()
      .from(shipments)
      .where(eq(shipments.id, shipmentId))
    if (parcel!.status === 'delivered') return shipmentView(parcel!)

    const [delivered] = await tx
      .update(shipments)
      .set({ status: 'delivered', deliveredAt: sql`now()` })
      .where(eq(shipments.id, shipmentId))
      .returning()
    const lines = await tx
      .update(orderItems)
      .set({ status: 'delivered' })
      .where(
        and(
          eq(orderItems.shipmentId, shipmentId),
          eq(orderItems.status, 'dispatched'),
        ),
      )
      .returning({ id: orderItems.id })
    const actor: OrderActor = {
      role: context.role,
      userId: context.userId,
    }
    for (const line of lines) {
      await recordOrderEvent(tx, {
        orderId: order.id,
        orderItemId: line.id,
        actorUserId: actor.userId,
        actorRole: actor.role,
        eventType: 'delivered',
        fromStatus: 'dispatched',
        toStatus: 'delivered',
      })
    }
    await completeIfDone(tx, order, actor)
    if (context.role === 'admin') {
      await recordAuditEntry(tx, {
        actorUserId: context.userId,
        actorRole: 'admin',
        action: 'shipment.mark_delivered',
        entityType: 'shipment',
        entityId: shipmentId,
        before: { status: 'dispatched' },
        after: { status: 'delivered', orderNumber: order.orderNumber },
        ip,
      })
    }
    return shipmentView(delivered!)
  })
}

const DONE: readonly string[] = [
  'delivered',
  'cancelled',
  'return_requested',
  'returned',
]

/** Completes a confirmed order whose every line has arrived or was cancelled. */
async function completeIfDone(
  tx: Transaction,
  order: OrderRow,
  actor: OrderActor,
): Promise<void> {
  if (order.status !== 'confirmed') return
  const lines = await orderLines(tx, order.id)
  if (!lines.every((line) => DONE.includes(line.status))) return
  const cash = order.paymentMethod === 'cod'
  await tx
    .update(orders)
    .set({
      status: 'completed',
      completedAt: sql`now()`,
      ...(cash ? { paidAt: sql`now()` } : {}),
    })
    .where(eq(orders.id, order.id))
  if (cash && (await captureCashPayment(tx, order.id))) {
    await recordOrderEvent(tx, {
      orderId: order.id,
      actorUserId: actor.userId,
      actorRole: actor.role,
      eventType: 'paid',
      note: 'Cash collected on delivery',
    })
  }
  await recordOrderEvent(tx, {
    orderId: order.id,
    actorUserId: actor.userId,
    actorRole: actor.role,
    eventType: 'completed',
    fromStatus: 'confirmed',
    toStatus: 'completed',
  })
}

function shipmentView(row: typeof shipments.$inferSelect): ShipmentView {
  return {
    id: row.id,
    courierName: row.courierName,
    trackingNumber: row.trackingNumber,
    trackingUrl: row.trackingUrl,
    status: row.status === 'delivered' ? 'delivered' : 'dispatched',
    dispatchedAt: row.dispatchedAt,
    deliveredAt: row.deliveredAt,
  }
}

/* Cancellation. */

/**
 * Cancels a locked order before dispatch (design doc 6.4): gives stock and
 * coupon use back, reverses the sellers' ledger entries, cancels the
 * invoices (their numbers stay used), and settles the payment: an unpaid
 * one is closed, and a paid online one is flagged for the administrator to
 * refund in the Razorpay dashboard. Then emails the buyer.
 */
async function cancelBeforeDispatch(
  tx: Transaction,
  queue: JobQueue,
  order: OrderRow,
  actor: OrderActor,
  reason: string,
): Promise<void> {
  if (order.status === 'cancelled') {
    throw new ConflictError(`Order ${order.orderNumber} is already cancelled`)
  }
  const lines = await orderLines(tx, order.id)
  if (!canBeCancelled(order.status, lines)) {
    throw new ConflictError(
      order.status === 'completed'
        ? `Order ${order.orderNumber} is already completed, so it cannot be cancelled`
        : `Part of order ${order.orderNumber} has been dispatched, so it cannot be cancelled now`,
    )
  }
  await markOrderCancelled(tx, order, lines, actor, reason)
  await reverseSales(tx, order.id, order.orderNumber)
  await cancelInvoices(tx, queue, {
    orderId: order.id,
    reason:
      actor.role === 'buyer'
        ? 'Cancelled by the buyer before dispatch'
        : `Cancelled by EcoKart before dispatch: ${reason}`.slice(0, 500),
  })

  const paid = (await paymentsOfOrder(tx, order.id)).find(
    (payment) =>
      payment.provider === 'razorpay' && payment.status === 'captured',
  )
  if (paid) {
    await recordOrderEvent(tx, {
      orderId: order.id,
      actorUserId: actor.userId,
      actorRole: actor.role,
      eventType: 'payment_needs_refund',
      note: `Cancelled after payment ${paid.providerPaymentId ?? paid.id}; refund it in the Razorpay dashboard`,
    })
  } else {
    await failPayment(tx, order.id, 'The order was cancelled')
  }

  if (order.buyerEmail) {
    await queueCancelledEmail(
      tx,
      queue,
      { userId: order.userId, email: order.buyerEmail },
      {
        orderNumber: order.orderNumber,
        buyerName: order.buyerName,
        placedAt: order.placedAt.toISOString(),
        cancelledBy: actor.role === 'buyer' ? 'buyer' : 'ecokart',
        reason,
        lines: lines.map(shipped),
        money: paid
          ? { kind: 'refund', amountPaise: paid.amountPaise }
          : { kind: 'nothing_charged' },
      },
    )
  }
}

/**
 * The buyer cancels their own order before anything in it is dispatched:
 * `{ "reason"?: "Ordered the wrong size" }`.
 */
export async function cancelOwnOrder(
  db: Database,
  deps: Deps,
  context: RequestContext,
  orderId: string,
  input: unknown,
): Promise<BuyerOrderView> {
  if (context.role !== 'buyer') {
    throw new ForbiddenError('This needs a buyer account')
  }
  const { reason } = parseInput(
    buyerCancellation,
    input ?? {},
    'Those cancellation details are not valid',
  )
  if (!isUuid(orderId)) throw missingOrder()
  await withContext(db, systemFor(context), async (tx) => {
    // Checked before taking the lock, so a guess at another buyer's order
    // id says nothing and waits for nothing.
    const [own] = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.userId, context.userId)))
    if (!own) throw missingOrder()
    const order = await lockOrder(tx, orderId)
    await cancelBeforeDispatch(
      tx,
      deps.queue,
      order,
      { role: 'buyer', userId: context.userId },
      reason ?? 'Cancelled by the buyer',
    )
  })
  return withContext(db, context, (tx) =>
    getBuyerOrder(tx, context, deps.photos, orderId),
  )
}

/**
 * An administrator cancels an order before dispatch on the buyer's behalf,
 * for example when the seller cannot supply it: `{ "reason": "..." }`.
 */
export async function cancelOrderAsAdmin(
  db: Database,
  deps: Deps,
  context: RequestContext,
  orderId: string,
  input: unknown,
  ip: string | null = null,
): Promise<AdminOrderView> {
  if (context.role !== 'admin') {
    throw new ForbiddenError('Only administrators can cancel orders for buyers')
  }
  const { reason } = parseInput(
    adminCancellation,
    input,
    'Those cancellation details are not valid',
  )
  if (!isUuid(orderId)) throw missingOrder()
  await withContext(db, systemFor(context), async (tx) => {
    const order = await lockOrder(tx, orderId)
    await cancelBeforeDispatch(
      tx,
      deps.queue,
      order,
      { role: 'admin', userId: context.userId },
      reason,
    )
    await recordAuditEntry(tx, {
      actorUserId: context.userId,
      actorRole: 'admin',
      action: 'order.cancel',
      entityType: 'order',
      entityId: orderId,
      before: { status: order.status },
      after: { status: 'cancelled', reason },
      ip,
    })
  })
  return withContext(db, context, (tx) =>
    getAdminOrder(tx, context, deps.photos, orderId),
  )
}
