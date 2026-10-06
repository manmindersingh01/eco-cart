import { addVariant, withContext } from '@ecokart/core'
import { handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireSeller } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

/** Adds a variant to a draft or rejected product. */
export const POST = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/seller/products/[id]/variants'>,
  ) => {
    const { context } = await requireSeller(request.headers)
    const { id } = await route.params
    const input = await readJsonBody(request)
    const product = await withContext(getDatabase(), context, (tx) =>
      addVariant(tx, getStorage(), context, id, input),
    )
    return Response.json({ product }, { status: 201 })
  },
)
