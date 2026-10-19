import { getOwnLedger, withContext } from '@ecokart/core'
import { handleErrors, pageQuery } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireSeller } from '@/lib/request-context'

/**
 * The seller's own ledger, newest first, with what EcoKart owes them now:
 * `?cursor=...&limit=20`.
 */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireSeller(request.headers)
  const ledger = await withContext(getDatabase(), context, (tx) =>
    getOwnLedger(tx, context, pageQuery(request)),
  )
  return Response.json(ledger)
})
