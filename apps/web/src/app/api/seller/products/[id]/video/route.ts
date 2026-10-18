import { addVideo, removeVideo, withContext } from '@ecokart/core'
import { handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { getJobQueue } from '@/lib/queue'
import { requireSeller } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

type Route = RouteContext<'/api/seller/products/[id]/video'>

/**
 * Adds the uploaded video: `{ "uploadKey": "uploads/..." }`. Answers 202,
 * because the worker checks and converts the video afterwards.
 */
export const POST = handleErrors(async (request: Request, route: Route) => {
  const { context } = await requireSeller(request.headers)
  const { id } = await route.params
  const input = await readJsonBody(request)
  const queue = await getJobQueue()
  const product = await withContext(getDatabase(), context, (tx) =>
    addVideo(tx, getStorage(), queue, context, id, input),
  )
  return Response.json({ product }, { status: 202 })
})

/** Removes the product's video. */
export const DELETE = handleErrors(async (request: Request, route: Route) => {
  const { context } = await requireSeller(request.headers)
  const { id } = await route.params
  const product = await withContext(getDatabase(), context, (tx) =>
    removeVideo(tx, getStorage(), context, id),
  )
  return Response.json({ product })
})
