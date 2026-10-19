import { and, count, eq, inArray, ne } from 'drizzle-orm'
import type { Transaction } from '../../db/client.ts'
import { orders } from '../../db/schema/index.ts'

/**
 * How many of `userId`'s orders used the coupon, not counting cancelled
 * ones, for the coupon's per-buyer limit (design doc 5.6: counted from
 * orders, so there is no usage table). An order waiting for payment counts,
 * so a buyer cannot start two orders with a one-use coupon.
 */
export async function countCouponUses(
  tx: Transaction,
  couponId: string,
  userId: string,
): Promise<number> {
  const [row] = await tx
    .select({ uses: count() })
    .from(orders)
    .where(
      and(
        eq(orders.couponId, couponId),
        eq(orders.userId, userId),
        ne(orders.status, 'cancelled'),
      ),
    )
  return row?.uses ?? 0
}

/** How many of the buyer's orders are waiting for an online payment. */
export async function countOrdersAwaitingPayment(
  tx: Transaction,
  userId: string,
): Promise<number> {
  const [row] = await tx
    .select({ waiting: count() })
    .from(orders)
    .where(and(eq(orders.userId, userId), eq(orders.status, 'pending_payment')))
  return row?.waiting ?? 0
}

/**
 * The order numbers of `ids`, by id, for documents that name orders, such
 * as a seller's settlement statement. The caller has already checked that
 * its reader may see them.
 */
export async function getOrderNumbers(
  tx: Transaction,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const rows = await tx
    .select({ id: orders.id, orderNumber: orders.orderNumber })
    .from(orders)
    .where(inArray(orders.id, [...new Set(ids)]))
  return new Map(rows.map((row) => [row.id, row.orderNumber]))
}
