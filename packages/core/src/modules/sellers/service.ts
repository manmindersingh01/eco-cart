import { eq } from 'drizzle-orm'
import type { Transaction } from '../../db/client.ts'
import { sellers } from '../../db/schema/index.ts'

/**
 * The seller business a seller account owns, or null if none is linked yet.
 * Row-level security lets a signed-in user read the seller they own, so the
 * caller's context only needs the user id.
 */
export async function findSellerIdForOwner(
  tx: Transaction,
  ownerUserId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: sellers.id })
    .from(sellers)
    .where(eq(sellers.ownerUserId, ownerUserId))
  return row?.id ?? null
}
