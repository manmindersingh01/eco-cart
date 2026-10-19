import { getProductForReview, withContext } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

/** One product with its seller and its recent reviews. */
export const GET = handleErrors(
  async (request: Request, route: RouteContext<'/api/admin/products/[id]'>) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    const review = await withContext(getDatabase(), context, (tx) =>
      getProductForReview(tx, getStorage(), context, id),
    )
    return Response.json(review)
  },
)
