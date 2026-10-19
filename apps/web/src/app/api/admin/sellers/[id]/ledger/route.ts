import { getSellerLedger, withContext } from '@ecokart/core'
import { handleErrors, pageQuery } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

/** The seller's ledger, newest first, with their balance: `?cursor=...&limit=20`. */
export const GET = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/sellers/[id]/ledger'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    const ledger = await withContext(getDatabase(), context, (tx) =>
      getSellerLedger(tx, context, id, pageQuery(request)),
    )
    return Response.json(ledger)
  },
)
