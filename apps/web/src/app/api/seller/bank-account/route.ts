import { getOwnBankAccount, withContext } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireSeller } from '@/lib/request-context'

/**
 * The bank account the seller's payouts go to, with only the last 4 digits
 * of the account number; `null` until an administrator enters it.
 */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireSeller(request.headers)
  const bankAccount = await withContext(getDatabase(), context, (tx) =>
    getOwnBankAccount(tx, context),
  )
  return Response.json({ bankAccount })
})
