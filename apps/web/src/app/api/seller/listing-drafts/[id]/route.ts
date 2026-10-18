import { getListingDraft, withContext } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireSeller } from '@/lib/request-context'

/**
 * One of the seller's listing drafts. Once `status` is `succeeded`, the
 * seller copies what they want from `suggestion` into the product with
 * PATCH /api/seller/products/{id}.
 */
export const GET = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/seller/listing-drafts/[id]'>,
  ) => {
    const { context } = await requireSeller(request.headers)
    const { id } = await route.params
    const draft = await withContext(getDatabase(), context, (tx) =>
      getListingDraft(tx, context, id),
    )
    return Response.json({ draft })
  },
)
