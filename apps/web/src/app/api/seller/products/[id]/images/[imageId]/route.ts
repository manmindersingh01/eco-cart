import { removeImage, updateImage, withContext } from '@ecokart/core'
import { handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireSeller } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

type Route = RouteContext<'/api/seller/products/[id]/images/[imageId]'>

/** Changes a photo's alt text or the variant it shows. */
export const PATCH = handleErrors(async (request: Request, route: Route) => {
  const { context } = await requireSeller(request.headers)
  const { id, imageId } = await route.params
  const input = await readJsonBody(request)
  const product = await withContext(getDatabase(), context, (tx) =>
    updateImage(tx, getStorage(), context, id, imageId, input),
  )
  return Response.json({ product })
})

/** Removes a photo from the product. */
export const DELETE = handleErrors(async (request: Request, route: Route) => {
  const { context } = await requireSeller(request.headers)
  const { id, imageId } = await route.params
  const product = await withContext(getDatabase(), context, (tx) =>
    removeImage(tx, getStorage(), context, id, imageId),
  )
  return Response.json({ product })
})
