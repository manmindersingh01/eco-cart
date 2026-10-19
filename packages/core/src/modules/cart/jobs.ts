import { and, inArray, isNull, lt } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import type { Database } from '../../db/client.ts'
import { carts } from '../../db/schema/index.ts'
import type { QueueDefinition } from '../../lib/queue.ts'
import { GUEST_CART_DAYS } from './types.ts'

/*
 * The nightly clean-up of guest carts. A guest's cart cookie lasts
 * GUEST_CART_DAYS after their last change to the cart, so a guest cart
 * unchanged for longer can never be opened again. A buyer's cart is kept,
 * because it belongs to their account.
 */

export const REMOVE_STALE_GUEST_CARTS_QUEUE = 'cart.remove-stale-guest-carts'

export const cartQueues: QueueDefinition[] = [
  {
    name: REMOVE_STALE_GUEST_CARTS_QUEUE,
    options: {
      retryLimit: 3,
      retryDelay: 60,
      retryBackoff: true,
      expireInSeconds: 300,
      deleteAfterSeconds: 7 * 24 * 60 * 60,
    },
  },
]

/** A day more than the cookie lasts, so a cart is never removed early. */
const STALE_AFTER_MS = (GUEST_CART_DAYS + 1) * 24 * 60 * 60 * 1000

/** Carts removed per statement, so no statement holds many locks for long. */
const BATCH = 500

/**
 * Removes guest carts unchanged for more than GUEST_CART_DAYS, with their
 * items, and returns how many. A cart that a request has locked for a
 * change right now is skipped.
 */
export async function removeStaleGuestCarts(
  db: Database,
  now: Date = new Date(),
): Promise<number> {
  const stale = and(
    isNull(carts.userId),
    lt(carts.updatedAt, new Date(now.getTime() - STALE_AFTER_MS)),
  )
  let removed = 0
  for (;;) {
    const batch = db
      .select({ id: carts.id })
      .from(carts)
      .where(stale)
      .limit(BATCH)
      .for('update', { skipLocked: true })
    const deleted = await db
      .delete(carts)
      .where(inArray(carts.id, batch))
      .returning({ id: carts.id })
    removed += deleted.length
    if (deleted.length < BATCH) return removed
  }
}

/**
 * Removes stale guest carts every night at 03:30 India time. A night the
 * worker was down gets one run when it starts again.
 */
export async function registerCartJobs(
  boss: PgBoss,
  deps: { db: Database },
): Promise<void> {
  await boss.schedule(REMOVE_STALE_GUEST_CARTS_QUEUE, '30 3 * * *', null, {
    tz: 'Asia/Kolkata',
    missed: 'once',
  })
  await boss.work(REMOVE_STALE_GUEST_CARTS_QUEUE, async () => {
    const removed = await removeStaleGuestCarts(deps.db)
    if (removed > 0) console.info(`Removed stale guest carts: ${removed}`)
  })
}
