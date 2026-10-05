import { sql } from 'drizzle-orm'
import type { Database, Transaction } from './client.ts'

/**
 * Who a database transaction acts for. Row-level security policies read these
 * values (design doc section 8, backend spec step 1).
 *
 * - anonymous: a visitor who is not signed in, optionally with a guest cart.
 * - buyer, seller, admin: a signed-in user with that account role.
 * - system: work that changes several parties' data at once, such as payment
 *   confirmation, run only after the service has checked permissions itself.
 */
export type RequestContext =
  | { role: 'anonymous'; guestToken?: string | undefined }
  | { role: 'buyer'; userId: string; guestToken?: string | undefined }
  | { role: 'seller'; userId: string; sellerId: string }
  | { role: 'admin'; userId: string }
  | { role: 'system'; userId?: string | undefined }

/**
 * Runs `work` in a transaction whose row-level security context is `context`.
 *
 * The values are set with set_config(..., true), the parameterised form of
 * SET LOCAL, so they end with the transaction and never leak to the next
 * request that reuses the pooled connection.
 */
export async function withContext<T>(
  db: Database,
  context: RequestContext,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const userId = 'userId' in context ? (context.userId ?? '') : ''
  const sellerId = context.role === 'seller' ? context.sellerId : ''
  const guestToken = 'guestToken' in context ? (context.guestToken ?? '') : ''

  return db.transaction(async (tx) => {
    await tx.execute(sql`
      select
        set_config('app.role', ${context.role}, true),
        set_config('app.user_id', ${userId}, true),
        set_config('app.seller_id', ${sellerId}, true),
        set_config('app.guest_token', ${guestToken}, true)
    `)
    return work(tx)
  })
}
