import { acceptSellerDocument, withContext } from '@ecokart/core'
import { clientIp, handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

/** Accepts the file waiting for review. */
export const POST = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/seller-documents/[id]/accept'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    const document = await withContext(getDatabase(), context, (tx) =>
      acceptSellerDocument(tx, context, id, clientIp(request)),
    )
    return Response.json({ document })
  },
)
