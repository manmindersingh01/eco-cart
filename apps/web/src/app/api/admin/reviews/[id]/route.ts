import { setReviewStatus, withContext } from '@ecokart/core'
import { clientIp, handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

/** Hides a review or shows it again: `{ "status": "hidden" }`. */
export const PATCH = handleErrors(
  async (request: Request, route: RouteContext<'/api/admin/reviews/[id]'>) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    const input = await readJsonBody(request)
    const review = await withContext(getDatabase(), context, (tx) =>
      setReviewStatus(tx, context, id, input, clientIp(request)),
    )
    return Response.json({ review })
  },
)
