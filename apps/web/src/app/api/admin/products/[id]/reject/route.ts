import { rejectProduct, withContext } from '@ecokart/core'
import { clientIp, handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

/** Rejects a listing waiting for review: `{ "reason": "..." }`. */
export const POST = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/products/[id]/reject'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    const input = await readJsonBody(request)
    const review = await withContext(getDatabase(), context, (tx) =>
      rejectProduct(tx, getStorage(), context, id, input, clientIp(request)),
    )
    return Response.json(review)
  },
)
