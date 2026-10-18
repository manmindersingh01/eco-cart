import { and, asc, eq, lt } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import type { Database } from '../../db/client.ts'
import { withContext } from '../../db/context.ts'
import { orders } from '../../db/schema/index.ts'
import type { QueueDefinition } from '../../lib/queue.ts'
import { failPayment } from '../payments/service.ts'
import { getSetting } from '../settings/service.ts'
import { cancelUnpaidOrder } from './service.ts'

/*
 * The order jobs (backend spec step 12): every five minutes, orders still
 * waiting for an online payment after `payment_timeout_minutes` are
 * cancelled, and their stock and coupon use given back (design doc 6.3
 * step 8).
 */

export const EXPIRE_UNPAID_QUEUE = 'orders.expire-unpaid'

export const orderQueues: QueueDefinition[] = [
  {
    // The next run five minutes later does the same work, so a failed run
    // is not retried, and runs are not kept for long.
    name: EXPIRE_UNPAID_QUEUE,
    options: {
      retryLimit: 0,
      expireInSeconds: 240,
      deleteAfterSeconds: 24 * 60 * 60,
    },
  },
]

/** Orders one run cancels at most; the next run takes the rest. */
const BATCH = 200

/**
 * Cancels the orders that have waited longer than the payment timeout.
 * Each order is cancelled in a transaction of its own, after taking its
 * lock, so a payment that arrives at the same moment either confirms the
 * order first or finds it cancelled and is flagged for a refund. Returns
 * the numbers of the orders it cancelled.
 */
export async function expireUnpaidOrders(
  db: Database,
  now: Date = new Date(),
): Promise<string[]> {
  const system = { role: 'system' as const }
  const minutes = await withContext(db, system, (tx) =>
    getSetting(tx, 'payment_timeout_minutes'),
  )
  const cutoff = new Date(now.getTime() - minutes * 60_000)
  const waiting = await withContext(db, system, (tx) =>
    tx
      .select({ id: orders.id, orderNumber: orders.orderNumber })
      .from(orders)
      .where(
        and(eq(orders.status, 'pending_payment'), lt(orders.createdAt, cutoff)),
      )
      .orderBy(asc(orders.createdAt), asc(orders.id))
      .limit(BATCH),
  )
  const reason = `Not paid within ${minutes} minutes`
  const cancelled: string[] = []
  for (const order of waiting) {
    const done = await withContext(db, system, async (tx) => {
      if (!(await cancelUnpaidOrder(tx, order.id, reason))) return false
      await failPayment(tx, order.id, reason)
      return true
    })
    if (done) cancelled.push(order.orderNumber)
  }
  return cancelled
}

/** Called by the worker at startup (apps/worker/src/worker.ts). */
export async function registerOrderJobs(
  boss: PgBoss,
  deps: { db: Database },
): Promise<void> {
  await boss.work(EXPIRE_UNPAID_QUEUE, async () => {
    const cancelled = await expireUnpaidOrders(deps.db)
    if (cancelled.length > 0) {
      console.info(`Cancelled unpaid orders: ${cancelled.join(', ')}`)
    }
  })
  await boss.schedule(EXPIRE_UNPAID_QUEUE, '*/5 * * * *')
}
