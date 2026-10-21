import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import type { Transaction } from '../../db/client.ts'
import type { RequestContext } from '../../db/context.ts'
import {
  orderEvents,
  orderItems,
  orders,
  shipments,
} from '../../db/schema/index.ts'
import { ForbiddenError, NotFoundError, ValidationError } from '../../errors.ts'
import { imageSizeKey } from '../../lib/images.ts'
import {
  afterCursor,
  afterOldestFirstCursor,
  exactTime,
  newestFirstCursor,
  pageSize,
  toPage,
  type Page,
} from '../../lib/pagination.ts'
import { qualified } from '../../lib/sql.ts'
import { isUuid } from '../../lib/validation.ts'
import type { PhotoAddresses } from '../catalogue/products.ts'
import { listOrderInvoices } from '../invoices/service.ts'
import {
  hasCapturedOnlinePayment,
  latestPaymentStatus,
  paymentsOfOrder,
  type PaymentRow,
} from '../payments/service.ts'
import { getSellerNames } from '../sellers/service.ts'
import type { OrderItemRow, OrderRow } from './service.ts'
import {
  LINE_STATUSES,
  oneOf,
  ORDER_STATUSES,
  SELLER_ORDER_TABS,
  type AdminOrderSummary,
  type AdminOrderView,
  type BuyerOrderSummary,
  type BuyerOrderView,
  type OrderLineView,
  type OrderProgress,
  type PaymentState,
  type SellerOrderSummary,
  type SellerOrderTab,
  type SellerOrderView,
  type ShipmentView,
  type VerifiedPurchase,
} from './types.ts'

/*
 * Reading orders after checkout (backend spec step 13): the buyer's own
 * orders, the seller's queue of their own lines, and every order for
 * administrators. Each runs in the caller's own context, so row-level
 * security repeats the checks made here.
 */

type ListOptions = { cursor?: string; limit?: number }

const RECEIVED: readonly string[] = [
  'delivered',
  'return_requested',
  'returned',
]

/** How far the order has got, from its lines. */
export function progressOf(
  status: string,
  lines: readonly { status: string }[],
): OrderProgress {
  if (status === 'cancelled') return 'cancelled'
  if (status === 'pending_payment') return 'awaiting_payment'
  const open = lines.filter((line) => line.status !== 'cancelled')
  const sent = open.filter((line) => line.status !== 'confirmed')
  const received = open.filter((line) => RECEIVED.includes(line.status))
  if (open.length > 0 && received.length === open.length) return 'delivered'
  if (open.length > 0 && sent.length === open.length) return 'dispatched'
  return sent.length > 0 ? 'partly_dispatched' : 'confirmed'
}

/** An order can be cancelled until any of its lines is dispatched. */
export function canBeCancelled(
  status: string,
  lines: readonly { status: string }[],
): boolean {
  return (
    (status === 'pending_payment' || status === 'confirmed') &&
    lines.every((line) => line.status === 'confirmed')
  )
}

function paymentStateOf(
  order: Pick<OrderRow, 'status' | 'paymentMethod'>,
  payments: readonly Pick<PaymentRow, 'status'>[],
): PaymentState {
  const latest = payments.at(-1)?.status
  if (latest === 'refunded') return 'refunded'
  const captured = latest === 'captured' || latest === 'partially_refunded'
  if (order.status === 'cancelled') {
    return captured ? 'refund_due' : 'not_charged'
  }
  if (captured) return 'paid'
  return order.paymentMethod === 'cod' ? 'pay_on_delivery' : 'awaiting_payment'
}

const needsRefundOf = (
  order: Pick<OrderRow, 'status' | 'paymentMethod'>,
  payments: readonly Pick<PaymentRow, 'status' | 'provider'>[],
) =>
  order.status === 'cancelled' &&
  payments.some(
    (payment) =>
      payment.provider === 'razorpay' && payment.status === 'captured',
  )

/** The database allows only these values, so anything else is a bug. */
function known<T extends string>(allowed: readonly T[], value: string): T {
  const found = oneOf(allowed, value)
  if (found === undefined) throw new Error(`Unexpected status ${value}`)
  return found
}
const asStatus = (status: string) => known(ORDER_STATUSES, status)
const asMethod = (method: string) => (method === 'cod' ? 'cod' : 'razorpay')

/** The lines with their shipments, seller names, and photos. */
async function lineViews(
  tx: Transaction,
  photos: PhotoAddresses,
  lines: readonly OrderItemRow[],
): Promise<OrderLineView[]> {
  const shipmentIds = [
    ...new Set(lines.flatMap((line) => line.shipmentId ?? [])),
  ]
  // One after the other: a transaction is one connection, which runs one
  // query at a time anyway.
  const parcels =
    shipmentIds.length > 0
      ? await tx
          .select()
          .from(shipments)
          .where(inArray(shipments.id, shipmentIds))
      : []
  const sellerNames = await getSellerNames(
    tx,
    lines.map((line) => line.sellerId),
  )
  const byId = new Map(
    parcels.map((parcel): [string, ShipmentView] => [
      parcel.id,
      {
        id: parcel.id,
        courierName: parcel.courierName,
        trackingNumber: parcel.trackingNumber,
        trackingUrl: parcel.trackingUrl,
        status: parcel.status === 'delivered' ? 'delivered' : 'dispatched',
        dispatchedAt: parcel.dispatchedAt,
        deliveredAt: parcel.deliveredAt,
      },
    ]),
  )
  return lines.map((line) => ({
    id: line.id,
    lineNumber: line.lineNumber,
    productId: line.productId,
    variantId: line.variantId,
    sellerId: line.sellerId,
    sellerName: sellerNames.get(line.sellerId) ?? null,
    title: line.title,
    sku: line.sku,
    options: line.options,
    imageUrl: line.imageKey
      ? photos.publicUrl(imageSizeKey(line.imageKey, 'thumb'))
      : null,
    quantity: line.quantity,
    unitPricePaise: line.unitPricePaise,
    unitMrpPaise: line.unitMrpPaise,
    lineTotalPaise: line.lineTotalPaise,
    discountSharePaise: line.discountSharePaise,
    gstRateBps: line.gstRateBps,
    status: known(LINE_STATUSES, line.status),
    shipment: line.shipmentId ? (byId.get(line.shipmentId) ?? null) : null,
  }))
}

/** Lines of `orderIds` matching `where`, in the order the buyer sees them. */
function linesOf(tx: Transaction, orderIds: readonly string[], where?: SQL) {
  if (orderIds.length === 0) return Promise.resolve([])
  return tx
    .select()
    .from(orderItems)
    .where(and(inArray(orderItems.orderId, [...orderIds]), where))
    .orderBy(
      asc(orderItems.orderId),
      asc(orderItems.lineNumber),
      asc(orderItems.id),
    )
}

const totalsOf = (order: OrderRow) => ({
  subtotalPaise: order.subtotalPaise,
  discountPaise: order.discountPaise,
  deliveryPaise: order.deliveryPaise,
  totalPaise: order.totalPaise,
  couponCode: order.couponCode,
})

function assertBuyer(
  context: RequestContext,
): asserts context is Extract<RequestContext, { role: 'buyer' }> {
  if (context.role !== 'buyer') {
    throw new ForbiddenError('This needs a buyer account')
  }
}

function assertSellerContext(
  context: RequestContext,
): asserts context is Extract<RequestContext, { role: 'seller' }> {
  if (context.role !== 'seller') {
    throw new ForbiddenError('This needs a seller account')
  }
}

function assertAdmin(
  context: RequestContext,
): asserts context is Extract<RequestContext, { role: 'admin' | 'system' }> {
  if (context.role !== 'admin' && context.role !== 'system') {
    throw new ForbiddenError('Only administrators can see every order')
  }
}

const notFound = () => new NotFoundError('There is no order with that id')

/* The buyer's orders. */

/** The buyer's orders, newest first, a page at a time. */
export async function listBuyerOrders(
  tx: Transaction,
  context: RequestContext,
  photos: PhotoAddresses,
  options: ListOptions = {},
): Promise<Page<BuyerOrderSummary>> {
  assertBuyer(context)
  const limit = pageSize(options.limit)
  const rows = await tx
    .select({ order: orders, cursorTime: exactTime(orders.createdAt) })
    .from(orders)
    .where(
      and(
        eq(orders.userId, context.userId),
        options.cursor
          ? afterCursor(options.cursor, orders.createdAt, orders.id)
          : undefined,
      ),
    )
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(limit + 1)
  const shown = rows.slice(0, limit)
  const lines = Map.groupBy(
    await linesOf(
      tx,
      shown.map((row) => row.order.id),
    ),
    (line) => line.orderId,
  )
  return toPage(
    rows,
    limit,
    ({ order }) => {
      const own = lines.get(order.id) ?? []
      const first = own[0]
      return {
        id: order.id,
        orderNumber: order.orderNumber,
        placedAt: order.placedAt,
        status: asStatus(order.status),
        progress: progressOf(order.status, own),
        paymentMethod: asMethod(order.paymentMethod),
        totalPaise: order.totalPaise,
        itemCount: own.reduce((count, line) => count + line.quantity, 0),
        firstItem: {
          title: first?.title ?? '',
          imageUrl: first?.imageKey
            ? photos.publicUrl(imageSizeKey(first.imageKey, 'thumb'))
            : null,
        },
      }
    },
    (row) =>
      newestFirstCursor({ cursorTime: row.cursorTime, id: row.order.id }),
  )
}

/** One of the buyer's own orders, or 404 for any other. */
export async function getBuyerOrder(
  tx: Transaction,
  context: RequestContext,
  photos: PhotoAddresses,
  orderId: string,
): Promise<BuyerOrderView> {
  assertBuyer(context)
  if (!isUuid(orderId)) throw notFound()
  const [order] = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.userId, context.userId)))
  if (!order) throw notFound()
  const lines = await linesOf(tx, [order.id])
  const payments = await paymentsOfOrder(tx, order.id)
  const invoices = await listOrderInvoices(tx, context, order.id)
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    placedAt: order.placedAt,
    status: asStatus(order.status),
    progress: progressOf(order.status, lines),
    paymentMethod: asMethod(order.paymentMethod),
    paymentState: paymentStateOf(order, payments),
    paidAt: order.paidAt,
    cancelledAt: order.cancelledAt,
    cancelReason: order.cancelReason,
    canCancel: canBeCancelled(order.status, lines),
    ...totalsOf(order),
    shippingAddress: order.shippingAddress,
    lines: await lineViews(tx, photos, lines),
    invoices,
  }
}

/* The seller's queue. */

/**
 * Orders a seller works on: confirmed ones, and cancelled ones that had
 * been confirmed. An online order that was never paid is none of the
 * seller's business.
 */
const sellerMaySee = or(
  inArray(orders.status, ['confirmed', 'completed']),
  and(
    eq(orders.status, 'cancelled'),
    or(eq(orders.paymentMethod, 'cod'), isNotNull(orders.paidAt)),
  ),
)!

const TAB_LINES: Record<SellerOrderTab, SQL> = {
  to_dispatch: and(
    eq(orderItems.status, 'confirmed'),
    eq(orders.status, 'confirmed'),
  )!,
  dispatched: eq(orderItems.status, 'dispatched'),
  delivered: inArray(orderItems.status, [...RECEIVED]),
  cancelled: eq(orderItems.status, 'cancelled'),
}

async function sellerOrderViews(
  tx: Transaction,
  sellerId: string,
  photos: PhotoAddresses,
  ordersShown: readonly OrderRow[],
): Promise<SellerOrderSummary[]> {
  const lines = Map.groupBy(
    await linesOf(
      tx,
      ordersShown.map((order) => order.id),
      eq(orderItems.sellerId, sellerId),
    ),
    (line) => line.orderId,
  )
  const views: SellerOrderSummary[] = []
  for (const order of ordersShown) {
    const own = lines.get(order.id) ?? []
    views.push({
      id: order.id,
      orderNumber: order.orderNumber,
      placedAt: order.placedAt,
      status: asStatus(order.status),
      paymentMethod: asMethod(order.paymentMethod),
      buyerName: order.buyerName,
      buyerPhone: order.buyerPhone,
      shippingAddress: order.shippingAddress,
      lines: await lineViews(tx, photos, own),
      sellerTotalPaise: own
        .filter((line) => line.status !== 'cancelled')
        .reduce(
          (total, line) =>
            total + line.lineTotalPaise - line.discountSharePaise,
          0,
        ),
    })
  }
  return views
}

/**
 * The seller's orders in one tab, with only their own lines. Orders to
 * dispatch come oldest first, so the longest-waiting parcel is packed
 * first; the other tabs show the newest first.
 */
export async function listSellerOrders(
  tx: Transaction,
  context: RequestContext,
  photos: PhotoAddresses,
  options: ListOptions & { tab?: string } = {},
): Promise<Page<SellerOrderSummary>> {
  assertSellerContext(context)
  const tab = oneOf(SELLER_ORDER_TABS, options.tab ?? 'to_dispatch')
  if (!tab) {
    throw new ValidationError('That order list is not valid', [
      `tab must be one of ${SELLER_ORDER_TABS.join(', ')}`,
    ])
  }
  const oldestFirst = tab === 'to_dispatch'
  const limit = pageSize(options.limit)
  // Every line of an order is written in one statement, so they share
  // created_at, and grouping by it keeps one row per order.
  const rows = await tx
    .select({
      orderId: orderItems.orderId,
      cursorTime: exactTime(orderItems.createdAt),
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(
        eq(orderItems.sellerId, context.sellerId),
        TAB_LINES[tab],
        sellerMaySee,
        options.cursor
          ? (oldestFirst ? afterOldestFirstCursor : afterCursor)(
              options.cursor,
              orderItems.createdAt,
              orderItems.orderId,
            )
          : undefined,
      ),
    )
    .groupBy(orderItems.orderId, orderItems.createdAt)
    .orderBy(
      ...(oldestFirst
        ? [asc(orderItems.createdAt), asc(orderItems.orderId)]
        : [desc(orderItems.createdAt), desc(orderItems.orderId)]),
    )
    .limit(limit + 1)
  const shownIds = rows.slice(0, limit).map((row) => row.orderId)
  const found =
    shownIds.length > 0
      ? await tx.select().from(orders).where(inArray(orders.id, shownIds))
      : []
  const byId = new Map(found.map((order) => [order.id, order]))
  const views = new Map(
    (
      await sellerOrderViews(
        tx,
        context.sellerId,
        photos,
        shownIds.flatMap((id) => byId.get(id) ?? []),
      )
    ).map((view) => [view.id, view]),
  )
  return toPage(
    rows,
    limit,
    (row) => views.get(row.orderId)!,
    (row) => newestFirstCursor({ cursorTime: row.cursorTime, id: row.orderId }),
  )
}

/** One order with the seller's own lines, or 404. */
export async function getSellerOrder(
  tx: Transaction,
  context: RequestContext,
  photos: PhotoAddresses,
  orderId: string,
): Promise<SellerOrderView> {
  assertSellerContext(context)
  if (!isUuid(orderId)) throw notFound()
  const [order] = await tx
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.id, orderId),
        sellerMaySee,
        sql`exists (select 1 from ${orderItems} where ${orderItems.orderId} = ${qualified(orders.id)} and ${orderItems.sellerId} = ${context.sellerId})`,
      ),
    )
  if (!order) throw notFound()
  const [view] = await sellerOrderViews(tx, context.sellerId, photos, [order])
  return {
    ...view!,
    invoices: await listOrderInvoices(tx, context, order.id),
  }
}

/* Every order, for administrators. */

/**
 * Every order, newest first, a page at a time. `needsRefund` lists the paid
 * orders that were cancelled and still need their refund; `orderNumber`
 * finds one order, for example when a buyer calls about it.
 */
export async function listAdminOrders(
  tx: Transaction,
  context: RequestContext,
  options: ListOptions & {
    status?: string
    needsRefund?: boolean
    orderNumber?: string
  } = {},
): Promise<Page<AdminOrderSummary>> {
  assertAdmin(context)
  if (options.status !== undefined && !oneOf(ORDER_STATUSES, options.status)) {
    throw new ValidationError('That order list is not valid', [
      `status must be one of ${ORDER_STATUSES.join(', ')}`,
    ])
  }
  const limit = pageSize(options.limit)
  const owesRefund = and(
    eq(orders.status, 'cancelled'),
    hasCapturedOnlinePayment(orders.id),
  )
  const rows = await tx
    .select({
      order: orders,
      cursorTime: exactTime(orders.createdAt),
      paymentStatus: latestPaymentStatus(orders.id),
      needsRefund: sql<boolean>`coalesce(${owesRefund}, false)`,
    })
    .from(orders)
    .where(
      and(
        options.status ? eq(orders.status, options.status) : undefined,
        options.needsRefund ? owesRefund : undefined,
        options.orderNumber
          ? eq(orders.orderNumber, options.orderNumber.trim().toUpperCase())
          : undefined,
        options.cursor
          ? afterCursor(options.cursor, orders.createdAt, orders.id)
          : undefined,
      ),
    )
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(limit + 1)
  return toPage(
    rows,
    limit,
    (row) => ({
      id: row.order.id,
      orderNumber: row.order.orderNumber,
      placedAt: row.order.placedAt,
      status: asStatus(row.order.status),
      paymentMethod: asMethod(row.order.paymentMethod),
      paymentStatus: row.paymentStatus,
      buyerName: row.order.buyerName,
      totalPaise: row.order.totalPaise,
      needsRefund: row.needsRefund,
    }),
    (row) =>
      newestFirstCursor({ cursorTime: row.cursorTime, id: row.order.id }),
  )
}

/** Everything about one order, for administrators. */
export async function getAdminOrder(
  tx: Transaction,
  context: RequestContext,
  photos: PhotoAddresses,
  orderId: string,
): Promise<AdminOrderView> {
  assertAdmin(context)
  if (!isUuid(orderId)) throw notFound()
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId))
  if (!order) throw notFound()
  const lines = await linesOf(tx, [order.id])
  const payments = await paymentsOfOrder(tx, order.id)
  const events = await tx
    .select()
    .from(orderEvents)
    .where(eq(orderEvents.orderId, order.id))
    .orderBy(asc(orderEvents.createdAt), asc(orderEvents.id))
  const invoices = await listOrderInvoices(tx, context, order.id)
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    userId: order.userId,
    placedAt: order.placedAt,
    status: asStatus(order.status),
    progress: progressOf(order.status, lines),
    paymentMethod: asMethod(order.paymentMethod),
    paymentState: paymentStateOf(order, payments),
    needsRefund: needsRefundOf(order, payments),
    canCancel: canBeCancelled(order.status, lines),
    paidAt: order.paidAt,
    cancelledAt: order.cancelledAt,
    completedAt: order.completedAt,
    cancelReason: order.cancelReason,
    buyerName: order.buyerName,
    buyerPhone: order.buyerPhone,
    buyerEmail: order.buyerEmail,
    ...totalsOf(order),
    shippingAddress: order.shippingAddress,
    lines: await lineViews(tx, photos, lines),
    payments: payments.map((payment) => ({
      id: payment.id,
      provider: payment.provider,
      status: payment.status,
      amountPaise: payment.amountPaise,
      method: payment.method,
      providerOrderId: payment.providerOrderId,
      providerPaymentId: payment.providerPaymentId,
      failureReason: payment.failureReason,
      createdAt: payment.createdAt,
    })),
    events: events.map((event) => ({
      id: event.id,
      orderItemId: event.orderItemId,
      actorRole: event.actorRole,
      eventType: event.eventType,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      note: event.note,
      createdAt: event.createdAt,
    })),
    invoices,
  }
}

/* Verified purchases, for reviews (step 16). */

/**
 * The buyer's latest received line of `productId`, or null when they have
 * not received it, so a review can say "verified purchase" without the
 * reviews module reading the orders tables.
 */
export async function findVerifiedPurchase(
  tx: Transaction,
  userId: string,
  productId: string,
): Promise<VerifiedPurchase | null> {
  if (!isUuid(userId) || !isUuid(productId)) return null
  const [row] = await tx
    .select({
      orderId: orderItems.orderId,
      orderItemId: orderItems.id,
      deliveredAt: shipments.deliveredAt,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .leftJoin(shipments, eq(shipments.id, orderItems.shipmentId))
    .where(
      and(
        eq(orders.userId, userId),
        eq(orderItems.productId, productId),
        inArray(orderItems.status, [...RECEIVED]),
      ),
    )
    .orderBy(desc(orders.createdAt), desc(orderItems.id))
    .limit(1)
  return row ?? null
}
