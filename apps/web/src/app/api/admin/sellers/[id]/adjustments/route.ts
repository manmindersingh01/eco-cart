import { recordAdjustment, withContext } from '@ecokart/core'
import { clientIp, handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

/**
 * Corrects the seller's balance: `{ "amountPaise": -1000, "reason": "..." }`,
 * positive to pay them more and negative to take money back. Answers 201
 * with the ledger entry and the seller's balance after it.
 */
export const POST = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/sellers/[id]/adjustments'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    const input = await readJsonBody(request)
    const recorded = await withContext(getDatabase(), context, (tx) =>
      recordAdjustment(tx, context, id, input, clientIp(request)),
    )
    return Response.json(recorded, { status: 201 })
  },
)
