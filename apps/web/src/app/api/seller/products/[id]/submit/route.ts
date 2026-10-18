import { submitProduct, withContext } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { getJobQueue } from '@/lib/queue'
import { requireSeller } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

/**
 * Submits a draft or rejected listing for review; the worker screens it
 * straight away. A listing that is not ready answers 400 with what to fix.
 */
export const POST = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/seller/products/[id]/submit'>,
  ) => {
    const { context } = await requireSeller(request.headers)
    const { id } = await route.params
    const queue = await getJobQueue()
    const product = await withContext(getDatabase(), context, (tx) =>
      submitProduct(tx, getStorage(), queue, context, id),
    )
    return Response.json({ product })
  },
)
