import { getDocumentRequest, withContext } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

/** One document request with every file sent for it. */
export const GET = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/seller-documents/[id]'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    const document = await withContext(getDatabase(), context, (tx) =>
      getDocumentRequest(tx, context, id),
    )
    return Response.json({ document })
  },
)
