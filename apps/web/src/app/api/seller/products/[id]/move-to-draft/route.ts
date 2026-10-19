import { moveToDraft, withContext } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireSeller } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

/**
 * Moves a listing back to draft so it can change: one waiting for review
 * (the review is withdrawn), one on sale (it leaves the storefront until it
 * is approved again), or one archived.
 */
export const POST = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/seller/products/[id]/move-to-draft'>,
  ) => {
    const { context } = await requireSeller(request.headers)
    const { id } = await route.params
    const product = await withContext(getDatabase(), context, (tx) =>
      moveToDraft(tx, getStorage(), context, id),
    )
    return Response.json({ product })
  },
)
