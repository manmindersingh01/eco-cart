import { rejectSellerDocument, withContext } from '@ecokart/core'
import { clientIp, handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

/**
 * Rejects the file waiting for review: `{ "reason": "..." }`, which the
 * seller sees. The request goes back to the seller for a new upload.
 */
export const POST = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/seller-documents/[id]/reject'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    const input = await readJsonBody(request)
    const document = await withContext(getDatabase(), context, (tx) =>
      rejectSellerDocument(tx, context, id, input, clientIp(request)),
    )
    return Response.json({ document })
  },
)
