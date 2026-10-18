import { and, count, eq, ne } from 'drizzle-orm'
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
