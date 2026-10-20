import { listSellerBalances, withContext } from '@ecokart/core'
import { handleErrors, pageQuery } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

/**
 * Sellers whose balance is not zero, largest first, with the bank account
 * a payout goes to: `?cursor=...&limit=20`.
 */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireAdmin(request.headers)
  const page = await withContext(getDatabase(), context, (tx) =>
    listSellerBalances(tx, context, pageQuery(request)),
  )
  return Response.json(page)
})
