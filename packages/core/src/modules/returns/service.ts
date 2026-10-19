import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, ne, type SQL } from 'drizzle-orm'
import type { Database, Transaction } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { returnPhotos, returnRequests } from '../../db/schema/index.ts'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  NotSignedInError,
  ValidationError,
} from '../../errors.ts'
import { imageSizeKey } from '../../lib/images.ts'
import { formatRupees } from '../../lib/money.ts'
import {
  afterCursor,
  afterOldestFirstCursor,
  exactTime,
  newestFirstCursor,
  pageSize,
  toPage,
  type Page,
} from '../../lib/pagination.ts'
import { uniqueViolation } from '../../lib/postgres.ts'
import type { JobQueue } from '../../lib/queue.ts'
import { isUuid, parseInput } from '../../lib/validation.ts'
import { recordAuditEntry } from '../audit/service.ts'
import type { PhotoAddresses } from '../catalogue/products.ts'
import { giveBackStock, lockStock } from '../catalogue/stock.ts'
import { recordReturnReversal } from '../ledger/service.ts'
import { queueRefundRecordedEmail } from '../notifications/service.ts'
import {
  changeLineStatus,
  linesWithOrders,
  lockOrderOfLine,
  recordOrderEvent,
  type OrderActor,
  type OrderItemRow,
} from '../orders/service.ts'
import { recordRefund, refundsOfReturns } from '../payments/service.ts'
import { getSellerNames } from '../sellers/service.ts'
import { getSetting } from '../settings/service.ts'
import { attachReturnPhotos } from './photos.ts'
import {
  newReturn,
  refundRecord,
  RETURN_REASONS,
  RETURN_STATUSES,
  returnApproval,
  returnRejection,
  type ReturnStatus,
  type ReturnView,
} from './types.ts'

/*
 * Returns and refunds (design doc 6.5, backend spec step 15). A buyer asks
 * to return a delivered line within the return window; an administrator
 * approves or rejects it; once the administrator has refunded the buyer in
 * the Razorpay dashboard (or by bank transfer for cash on delivery), they
 * record the refund here, which puts the item back in stock, marks the
 * line returned, and takes the refund back from the seller's ledger. The
 * seller sees the returns of their own lines.
 *
 * Every change takes the order's row lock first, like the other order
 * changes, then the return's own row.
 */

type ReturnRow = typeof returnRequests.$inferSelect
type ListOptions = { cursor?: string; limit?: number }

const MISSING = 'There is no return with that id'
const missingReturn = () => new NotFoundError(MISSING)
const DAY_MS = 24 * 60 * 60 * 1000

const shortDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Kolkata',
})

const REASON_WORDS: Record<string, string> = {
  damaged: 'arrived damaged',
  defective: 'does not work',
  wrong_item: 'wrong item sent',
  not_as_described: 'not as described',
  missing_parts: 'parts missing',
  no_longer_needed: 'no longer needed',
  other: 'other reason',
}

function assertBuyer(
  context: RequestContext,
): asserts context is Extract<RequestContext, { role: 'buyer' }> {
  if (context.role === 'anonymous') throw new NotSignedInError()
  if (context.role !== 'buyer') {
    throw new ForbiddenError('Only buyers can return items')
  }
}

function assertAdmin(
  context: RequestContext,
): asserts context is Extract<RequestContext, { role: 'admin' }> {
  if (context.role !== 'admin') {
    throw new ForbiddenError('Only administrators can decide returns')
  }
}

const systemFor = (userId: string): RequestContext => ({
  role: 'system',
  userId,
})

function known<T extends string>(allowed: readonly T[], value: string): T {
  const found = allowed.find((choice) => choice === value)
  if (found === undefined) throw new Error(`Unexpected value ${value}`)
  return found
}

/* What a line has already given back. */

interface Returned {
  quantity: number
  amountPaise: number
}

/** The line's refunded returns other than `except`: how many, how much. */
async function returnedBefore(
  tx: Transaction,
  orderItemId: string,
  except: string | null,
): Promise<Returned> {
  const done = await tx
    .select({ id: returnRequests.id, quantity: returnRequests.quantity })
    .from(returnRequests)
    .where(
      and(
        eq(returnRequests.orderItemId, orderItemId),
        eq(returnRequests.status, 'refunded'),
        except ? ne(returnRequests.id, except) : undefined,
      ),
    )
  const refunds = await refundsOfReturns(
    tx,
    done.map((row) => row.id),
  )
  return {
    quantity: done.reduce((sum, row) => sum + row.quantity, 0),
    amountPaise: [...refunds.values()].reduce(
      (sum, refund) => sum + refund.amountPaise,
      0,
    ),
  }
}

/**
 * The most a return of `quantity` may refund: its share of what the buyer
 * paid for the line after any coupon, and for the last of the line, exactly
 * what is left, so the line's refunds add up to what was paid. For example
 * a line of 3 that cost ₹300 after the coupon refunds at most ₹100 for 1,
 * and the last 2 refund at most ₹300 less what the first return refunded.
 */
function maxRefund(
  line: Pick<
    OrderItemRow,
    'lineTotalPaise' | 'discountSharePaise' | 'quantity'
  >,
  quantity: number,
  before: Returned,
): number {
  const paid = line.lineTotalPaise - line.discountSharePaise
  if (before.quantity + quantity >= line.quantity) {
    return paid - before.amountPaise
  }
  return Math.floor((paid * quantity) / line.quantity)
}

/* Opening a return. */

/**
 * The buyer asks to return a delivered line, or part of it, within the
 * return window, with a reason and up to five checked photos.
 */
export async function openReturn(
  db: Database,
  deps: { photos: PhotoAddresses },
  context: RequestContext,
  input: unknown,
): Promise<ReturnView> {
  assertBuyer(context)
  const request = parseInput(newReturn, input, 'That return cannot be sent')
  const returnId = await withContext(
    db,
    systemFor(context.userId),
    async (tx) => {
      const { order, line, deliveredAt } = await lockOrderOfLine(
        tx,
        request.orderItemId,
      )
      if (order.userId !== context.userId) {
        throw new NotFoundError('There is no order line with that id')
      }
      if (line.status === 'return_requested') {
        throw new ConflictError(
          `${line.title} already has a return waiting for a decision`,
        )
      }
      if (line.status === 'returned') {
        throw new ConflictError(`${line.title} has already been returned`)
      }
      if (line.status !== 'delivered' || !deliveredAt) {
        throw new ConflictError(
          `${line.title} can be returned once it has been delivered`,
        )
      }
      const days = await getSetting(tx, 'return_window_days')
      const until = new Date(deliveredAt.getTime() + days * DAY_MS)
      if (Date.now() > until.getTime()) {
        throw new ConflictError(
          `${line.title} could be returned until ${shortDate.format(until)}; the ${days}-day return window has closed`,
        )
      }
      const left =
        line.quantity - (await returnedBefore(tx, line.id, null)).quantity
      const quantity = request.quantity ?? left
      if (quantity > left) {
        throw new ValidationError('That return cannot be sent', [
          `quantity must be at most ${left}`,
        ])
      }

      const id = randomUUID()
      try {
        await tx.insert(returnRequests).values({
          id,
          orderId: order.id,
          orderItemId: line.id,
          userId: context.userId,
          sellerId: line.sellerId,
          quantity,
          reasonCode: request.reasonCode,
          reasonText: request.reasonText ?? null,
        })
      } catch (error) {
        if (uniqueViolation(error) === 'return_requests_open_line_key') {
          throw new ConflictError(
            `${line.title} already has a return waiting for a decision`,
          )
        }
        throw error
      }
      const images = await attachReturnPhotos(tx, context, id, request.photoIds)
      if (images.length > 0) {
        await tx
          .update(returnRequests)
          .set({ images })
          .where(eq(returnRequests.id, id))
      }
      await changeLineStatus(tx, {
        orderId: order.id,
        lineId: line.id,
        from: 'delivered',
        to: 'return_requested',
        actor: { role: 'buyer', userId: context.userId },
        eventType: 'return_requested',
        note: `${quantity} × ${REASON_WORDS[request.reasonCode]}`,
      })
      return id
    },
  )
  return withContext(db, context, (tx) =>
    getReturn(tx, context, deps.photos, returnId),
  )
}

/* The administrator's decisions. */

/**
 * Locks the return's order, then the return, and hands both to `change`.
 * Runs as `context` for a decision and as `system` for a refund.
 */
async function withLockedReturn<T>(
  tx: Transaction,
  returnId: string,
  change: (
    found: ReturnRow,
    order: Awaited<ReturnType<typeof lockOrderOfLine>>,
  ) => Promise<T>,
): Promise<T> {
  if (!isUuid(returnId)) throw missingReturn()
  const [first] = await tx
    .select({ orderItemId: returnRequests.orderItemId })
    .from(returnRequests)
    .where(eq(returnRequests.id, returnId))
  if (!first) throw missingReturn()
  const ofLine = await lockOrderOfLine(tx, first.orderItemId)
  const [found] = await tx
    .select()
    .from(returnRequests)
    .where(eq(returnRequests.id, returnId))
    .for('update')
  return change(found!, ofLine)
}

const STATUS_WORDS: Record<ReturnStatus, string> = {
  requested: 'still waiting for a decision',
  approved: 'already approved',
  rejected: 'already rejected',
  refunded: 'already refunded',
}

/** The administrator accepts the return: `{ "note"?: "..." }`. */
export async function approveReturn(
  db: Database,
  deps: { photos: PhotoAddresses },
  context: RequestContext,
  returnId: string,
  input: unknown,
  ip: string | null = null,
): Promise<ReturnView> {
  assertAdmin(context)
  const { note } = parseInput(
    returnApproval,
    input ?? {},
    'That return cannot be approved',
  )
  await withContext(db, context, (tx) =>
    withLockedReturn(tx, returnId, async (found, { order }) => {
      if (found.status !== 'requested') {
        throw new ConflictError(
          `This return is ${STATUS_WORDS[known(RETURN_STATUSES, found.status)]}`,
        )
      }
      await tx
        .update(returnRequests)
        .set({
          status: 'approved',
          adminNote: note ?? null,
          decidedBy: context.userId,
          decidedAt: new Date(),
        })
        .where(eq(returnRequests.id, found.id))
      await recordOrderEvent(tx, {
        orderId: order.id,
        orderItemId: found.orderItemId,
        actorUserId: context.userId,
        actorRole: 'admin',
        eventType: 'return_approved',
        ...(note ? { note } : {}),
      })
      await recordAuditEntry(tx, {
        actorUserId: context.userId,
        actorRole: 'admin',
        action: 'return.approve',
        entityType: 'return_request',
        entityId: found.id,
        before: { status: found.status },
        after: { status: 'approved', note: note ?? null },
        ip,
      })
    }),
  )
  return withContext(db, context, (tx) =>
    getReturn(tx, context, deps.photos, returnId),
  )
}

/**
 * The administrator turns the return down, saying why: `{ "note": "..." }`.
 * An approved return can still be rejected, for example when the item never
 * came back. The line is delivered again, so the buyer may ask again while
 * the return window is open.
 */
export async function rejectReturn(
  db: Database,
  deps: { photos: PhotoAddresses },
  context: RequestContext,
  returnId: string,
  input: unknown,
  ip: string | null = null,
): Promise<ReturnView> {
  assertAdmin(context)
  const { note } = parseInput(
    returnRejection,
    input,
    'That return cannot be rejected',
  )
  await withContext(db, context, (tx) =>
    withLockedReturn(tx, returnId, async (found, { order }) => {
      if (found.status !== 'requested' && found.status !== 'approved') {
        throw new ConflictError(
          `This return is ${STATUS_WORDS[known(RETURN_STATUSES, found.status)]}`,
        )
      }
      await tx
        .update(returnRequests)
        .set({
          status: 'rejected',
          adminNote: note,
          decidedBy: context.userId,
          decidedAt: new Date(),
        })
        .where(eq(returnRequests.id, found.id))
      await changeLineStatus(tx, {
        orderId: order.id,
        lineId: found.orderItemId,
        from: 'return_requested',
        to: 'delivered',
        actor: { role: 'admin', userId: context.userId },
        eventType: 'return_rejected',
        note,
      })
      await recordAuditEntry(tx, {
        actorUserId: context.userId,
        actorRole: 'admin',
        action: 'return.reject',
        entityType: 'return_request',
        entityId: found.id,
        before: { status: found.status },
        after: { status: 'rejected', note },
        ip,
      })
    }),
  )
  return withContext(db, context, (tx) =>
    getReturn(tx, context, deps.photos, returnId),
  )
}

/* The refund. */

/**
 * Records the refund of an approved return (design doc 6.5 step 4), in one
 * transaction: the refund, the return marked refunded, the seller's
 * refund and commission reversals, the line returned (or delivered again
 * when only part of it came back), the stock given back, and the refund
 * recorded email. `{ "method": "gateway",
 * "amountPaise", "razorpayRefundId" }`, or `{ "method": "bank_transfer",
 * "amountPaise", "note": "<bank reference>" }`.
 */
export async function recordReturnRefund(
  db: Database,
  deps: { queue: JobQueue; photos: PhotoAddresses },
  context: RequestContext,
  returnId: string,
  input: unknown,
  ip: string | null = null,
): Promise<ReturnView> {
  assertAdmin(context)
  const refund = parseInput(
    refundRecord,
    input,
    'That refund cannot be recorded',
  )
  await withContext(db, systemFor(context.userId), (tx) =>
    withLockedReturn(tx, returnId, async (found, { order, line }) => {
      if (found.status !== 'approved') {
        throw new ConflictError(
          found.status === 'requested'
            ? 'Approve this return before recording its refund'
            : `This return is ${STATUS_WORDS[known(RETURN_STATUSES, found.status)]}`,
        )
      }
      if (refund.method === 'gateway' && order.paymentMethod !== 'razorpay') {
        throw new ValidationError('That refund cannot be recorded', [
          'method must be bank_transfer for a cash on delivery order',
        ])
      }
      const before = await returnedBefore(tx, line.id, found.id)
      const most = maxRefund(line, found.quantity, before)
      if (refund.amountPaise > most) {
        throw new ConflictError(
          `This return can be refunded at most ${formatRupees(most)}`,
        )
      }
      const recorded = await recordRefund(tx, {
        orderId: order.id,
        returnRequestId: found.id,
        amountPaise: refund.amountPaise,
        method: refund.method,
        providerRefundId:
          refund.method === 'gateway' ? refund.razorpayRefundId : null,
        note: refund.note ?? null,
        recordedBy: context.userId,
      })
      await tx
        .update(returnRequests)
        .set({ status: 'refunded', refundId: recorded.id })
        .where(eq(returnRequests.id, found.id))
      await recordReturnReversal(tx, {
        sellerId: line.sellerId,
        orderId: order.id,
        orderItemId: line.id,
        returnRequestId: found.id,
        orderNumber: order.orderNumber,
        title: line.title,
        returnedQuantity: found.quantity,
        refundPaise: refund.amountPaise,
        linePaidPaise: line.lineTotalPaise - line.discountSharePaise,
        commissionBps: line.commissionBps,
        lineCommissionPaise: line.commissionPaise,
        createdBy: context.userId,
      })

      const whole = before.quantity + found.quantity >= line.quantity
      const actor: OrderActor = { role: 'admin', userId: context.userId }
      await changeLineStatus(tx, {
        orderId: order.id,
        lineId: line.id,
        from: 'return_requested',
        to: whole ? 'returned' : 'delivered',
        actor,
        eventType: 'refund_recorded',
        note: `${formatRupees(refund.amountPaise)} for ${found.quantity} returned`,
      })
      await lockStock(tx, [line.variantId])
      await giveBackStock(tx, [
        {
          productId: line.productId,
          variantId: line.variantId,
          quantity: found.quantity,
        },
      ])
      if (order.buyerEmail) {
        await queueRefundRecordedEmail(
          tx,
          deps.queue,
          { userId: order.userId, email: order.buyerEmail },
          {
            orderNumber: order.orderNumber,
            buyerName: order.buyerName,
            amountPaise: refund.amountPaise,
            method: refund.method,
            lines: [
              {
                title: line.title,
                options: line.options,
                quantity: found.quantity,
              },
            ],
          },
        )
      }
      await recordAuditEntry(tx, {
        actorUserId: context.userId,
        actorRole: 'admin',
        action: 'return.refund',
        entityType: 'return_request',
        entityId: found.id,
        before: { status: 'approved' },
        after: {
          status: 'refunded',
          amountPaise: refund.amountPaise,
          method: refund.method,
        },
        ip,
      })
    }),
  )
  return withContext(db, context, (tx) =>
    getReturn(tx, context, deps.photos, returnId),
  )
}

/* Reading returns. */

/** What `context` may see of the returns table, on top of row-level security. */
function visibleTo(context: RequestContext): SQL | undefined {
  switch (context.role) {
    case 'buyer':
      return eq(returnRequests.userId, context.userId)
    case 'seller':
      return eq(returnRequests.sellerId, context.sellerId)
    case 'admin':
    case 'system':
      return undefined
    default:
      throw new NotSignedInError()
  }
}

async function returnViews(
  tx: Transaction,
  context: RequestContext,
  photos: PhotoAddresses,
  rows: readonly ReturnRow[],
): Promise<ReturnView[]> {
  if (rows.length === 0) return []
  const ids = rows.map((row) => row.id)
  // One after the other: a transaction is one connection, which runs one
  // query at a time anyway.
  const lines = await linesWithOrders(
    tx,
    rows.map((row) => row.orderItemId),
  )
  const sellerNames = await getSellerNames(
    tx,
    rows.map((row) => row.sellerId),
  )
  // Sellers see refunds in their ledger, not here.
  const refunds =
    context.role === 'seller'
      ? new Map<string, never>()
      : await refundsOfReturns(tx, ids)
  const photoRows = await tx
    .select({
      id: returnPhotos.id,
      returnRequestId: returnPhotos.returnRequestId,
    })
    .from(returnPhotos)
    .where(inArray(returnPhotos.returnRequestId, ids))
    .orderBy(asc(returnPhotos.createdAt), asc(returnPhotos.id))
  const photosOf = Map.groupBy(photoRows, (photo) => photo.returnRequestId)
  const views: ReturnView[] = []
  for (const row of rows) {
    views.push(await viewOf(row))
  }
  return views

  async function viewOf(row: ReturnRow): Promise<ReturnView> {
    const found = lines.get(row.orderItemId)
    if (!found) throw new Error(`Return ${row.id} has no visible order line`)
    const { line, order } = found
    const refund = refunds.get(row.id)
    return {
      id: row.id,
      status: known(RETURN_STATUSES, row.status),
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderItemId: line.id,
      item: {
        title: line.title,
        options: line.options,
        sku: line.sku,
        imageUrl: line.imageKey
          ? photos.publicUrl(imageSizeKey(line.imageKey, 'thumb'))
          : null,
        unitPricePaise: line.unitPricePaise,
        lineQuantity: line.quantity,
      },
      sellerId: row.sellerId,
      sellerName: sellerNames.get(row.sellerId) ?? null,
      buyerName: order.buyerName,
      quantity: row.quantity,
      reasonCode: known(RETURN_REASONS, row.reasonCode),
      reasonText: row.reasonText,
      photoIds: (photosOf.get(row.id) ?? []).map((photo) => photo.id),
      adminNote: row.adminNote,
      decidedAt: row.decidedAt,
      maxRefundPaise: refund
        ? refund.amountPaise
        : maxRefund(
            line,
            row.quantity,
            await returnedBefore(tx, line.id, row.id),
          ),
      refund:
        refund &&
        (refund.method === 'gateway' || refund.method === 'bank_transfer')
          ? {
              amountPaise: refund.amountPaise,
              method: refund.method,
              recordedAt: refund.recordedAt,
            }
          : null,
      createdAt: row.createdAt,
    }
  }
}

/** One return its buyer, its seller, or an administrator may see; else 404. */
export async function getReturn(
  tx: Transaction,
  context: RequestContext,
  photos: PhotoAddresses,
  returnId: string,
): Promise<ReturnView> {
  const visible = visibleTo(context)
  if (!isUuid(returnId)) throw missingReturn()
  const rows = await tx
    .select()
    .from(returnRequests)
    .where(and(eq(returnRequests.id, returnId), visible))
  if (rows.length === 0) throw missingReturn()
  const [view] = await returnViews(tx, context, photos, rows)
  return view!
}

/** The buyer's returns, newest first. */
export async function listOwnReturns(
  tx: Transaction,
  context: RequestContext,
  photos: PhotoAddresses,
  options: ListOptions = {},
): Promise<Page<ReturnView>> {
  assertBuyer(context)
  return listReturnsWhere(tx, context, photos, options, {
    where: eq(returnRequests.userId, context.userId),
    oldestFirst: false,
  })
}

/** The returns of the seller's lines, newest first, optionally by status. */
export async function listSellerReturns(
  tx: Transaction,
  context: RequestContext,
  photos: PhotoAddresses,
  options: ListOptions & { status?: string } = {},
): Promise<Page<ReturnView>> {
  if (context.role !== 'seller') {
    throw new ForbiddenError('This needs a seller account')
  }
  return listReturnsWhere(tx, context, photos, options, {
    where: and(
      eq(returnRequests.sellerId, context.sellerId),
      statusFilter(options.status),
    ),
    oldestFirst: false,
  })
}

/**
 * Every return in one status, for administrators. Returns waiting for a
 * decision or a refund come oldest first, so the longest wait is handled
 * first; finished ones come newest first.
 */
export async function listReturns(
  tx: Transaction,
  context: RequestContext,
  photos: PhotoAddresses,
  options: ListOptions & { status?: string } = {},
): Promise<Page<ReturnView>> {
  assertAdmin(context)
  const status = options.status ?? 'requested'
  return listReturnsWhere(tx, context, photos, options, {
    where: statusFilter(status),
    oldestFirst: status === 'requested' || status === 'approved',
  })
}

function statusFilter(status: string | undefined): SQL | undefined {
  if (status === undefined) return undefined
  if (!RETURN_STATUSES.some((choice) => choice === status)) {
    throw new ValidationError('That list of returns is not valid', [
      `status must be one of ${RETURN_STATUSES.join(', ')}`,
    ])
  }
  return eq(returnRequests.status, status)
}

async function listReturnsWhere(
  tx: Transaction,
  context: RequestContext,
  photos: PhotoAddresses,
  options: ListOptions,
  query: { where: SQL | undefined; oldestFirst: boolean },
): Promise<Page<ReturnView>> {
  const limit = pageSize(options.limit)
  const after = query.oldestFirst ? afterOldestFirstCursor : afterCursor
  const rows = await tx
    .select({
      request: returnRequests,
      cursorTime: exactTime(returnRequests.createdAt),
    })
    .from(returnRequests)
    .where(
      and(
        query.where,
        options.cursor
          ? after(options.cursor, returnRequests.createdAt, returnRequests.id)
          : undefined,
      ),
    )
    .orderBy(
      ...(query.oldestFirst
        ? [asc(returnRequests.createdAt), asc(returnRequests.id)]
        : [desc(returnRequests.createdAt), desc(returnRequests.id)]),
    )
    .limit(limit + 1)
  const views = new Map(
    (
      await returnViews(
        tx,
        context,
        photos,
        rows.slice(0, limit).map((row) => row.request),
      )
    ).map((view) => [view.id, view]),
  )
  return toPage(
    rows,
    limit,
    (row) => views.get(row.request.id)!,
    (row) =>
      newestFirstCursor({ cursorTime: row.cursorTime, id: row.request.id }),
  )
}
