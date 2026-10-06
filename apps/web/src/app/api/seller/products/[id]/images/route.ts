import { addImage, withContext } from '@ecokart/core'
import { handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { getJobQueue } from '@/lib/queue'
import { requireSeller } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

/**
 * Adds an uploaded photo: `{ "uploadKey": "uploads/..." }`. Answers 202,
 * because the worker checks the photo and makes its sizes afterwards.
 */
export const POST = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/seller/products/[id]/images'>,
  ) => {
    const { context } = await requireSeller(request.headers)
    const { id } = await route.params
    const input = await readJsonBody(request)
    const queue = await getJobQueue()
    const product = await withContext(getDatabase(), context, (tx) =>
      addImage(tx, getStorage(), queue, context, id, input),
    )
    return Response.json({ product }, { status: 202 })
  },
)
