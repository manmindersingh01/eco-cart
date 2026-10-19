import { recordPayout, withContext } from '@ecokart/core'
import { clientIp, handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

/**
 * Records a bank transfer made to the seller:
 * `{ "amountPaise": 100000, "reference": "UTR..." }`. Answers 201 with the
 * ledger entry and the seller's balance after it.
 */
export const POST = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/sellers/[id]/payouts'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    const input = await readJsonBody(request)
    const recorded = await withContext(getDatabase(), context, (tx) =>
      recordPayout(tx, context, id, input, clientIp(request)),
    )
    return Response.json(recorded, { status: 201 })
  },
)
