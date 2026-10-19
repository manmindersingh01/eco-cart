import { archiveProduct, withContext } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireSeller } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

/** Takes an approved listing off sale; it stays for past orders. */
export const POST = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/seller/products/[id]/archive'>,
  ) => {
    const { context } = await requireSeller(request.headers)
    const { id } = await route.params
    const product = await withContext(getDatabase(), context, (tx) =>
      archiveProduct(tx, getStorage(), context, id),
    )
    return Response.json({ product })
  },
)
