import { approveProduct, withContext } from '@ecokart/core'
import { clientIp, handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

/**
 * Approves a listing waiting for review: `{}` for the category's GST rate,
 * or `{ "gstRateBps": 500 }` to give another.
 */
export const POST = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/products/[id]/approve'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    const input = await readJsonBody(request)
    const review = await withContext(getDatabase(), context, (tx) =>
      approveProduct(tx, getStorage(), context, id, input, clientIp(request)),
    )
    return Response.json(review)
  },
)
