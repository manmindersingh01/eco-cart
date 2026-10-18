import { getOwnReview, updateOwnReview, withContext } from '@ecokart/core'
import { handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireBuyer } from '@/lib/request-context'

/** The buyer's own review of the product, also when it is hidden; or 404. */
export const GET = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/products/[slug]/reviews/mine'>,
  ) => {
    const { context } = await requireBuyer(request.headers)
    const { slug } = await route.params
    const review = await withContext(getDatabase(), context, (tx) =>
      getOwnReview(tx, context, slug),
    )
    return Response.json({ review })
  },
)

/** Changes any of the buyer's rating, name, title, and text. */
export const PATCH = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/products/[slug]/reviews/mine'>,
  ) => {
    const { context } = await requireBuyer(request.headers)
    const { slug } = await route.params
    const input = await readJsonBody(request)
    const review = await withContext(getDatabase(), context, (tx) =>
      updateOwnReview(tx, context, slug, input),
    )
    return Response.json({ review })
  },
)
