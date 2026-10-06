import { setImageOrder, withContext } from '@ecokart/core'
import { handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireSeller } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

/** Puts the photos in order: `{ "imageIds": [...] }`, main photo first. */
export const PUT = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/seller/products/[id]/images/order'>,
  ) => {
    const { context } = await requireSeller(request.headers)
    const { id } = await route.params
    const input = await readJsonBody(request)
    const product = await withContext(getDatabase(), context, (tx) =>
      setImageOrder(tx, getStorage(), context, id, input),
    )
    return Response.json({ product })
  },
)
