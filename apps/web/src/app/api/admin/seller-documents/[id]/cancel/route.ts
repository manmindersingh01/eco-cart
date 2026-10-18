import { cancelSellerDocument, withContext } from '@ecokart/core'
import { clientIp, handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

/**
 * Withdraws a request that is no longer needed: `{ "reason": "..." }`,
 * which the seller sees.
 */
export const POST = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/seller-documents/[id]/cancel'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    const input = await readJsonBody(request)
    const document = await withContext(getDatabase(), context, (tx) =>
      cancelSellerDocument(tx, context, id, input, clientIp(request)),
    )
    return Response.json({ document })
  },
)
