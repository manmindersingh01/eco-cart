import {
  deleteProduct,
  getOwnProduct,
  updateProduct,
  withContext,
} from '@ecokart/core'
import { handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireSeller } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

type Route = RouteContext<'/api/seller/products/[id]'>

/** One of the seller's products with its variants and photos. */
export const GET = handleErrors(async (request: Request, route: Route) => {
  const { context } = await requireSeller(request.headers)
  const { id } = await route.params
  const product = await withContext(getDatabase(), context, (tx) =>
    getOwnProduct(tx, getStorage(), context, id),
  )
  return Response.json({ product })
})

/** Changes listing details of a draft or rejected product. */
export const PATCH = handleErrors(async (request: Request, route: Route) => {
  const { context } = await requireSeller(request.headers)
  const { id } = await route.params
  const input = await readJsonBody(request)
  const product = await withContext(getDatabase(), context, (tx) =>
    updateProduct(tx, getStorage(), context, id, input),
  )
  return Response.json({ product })
})

/** Deletes a draft or rejected product. */
export const DELETE = handleErrors(async (request: Request, route: Route) => {
  const { context } = await requireSeller(request.headers)
  const { id } = await route.params
  await withContext(getDatabase(), context, (tx) =>
    deleteProduct(tx, context, id),
  )
  return new Response(null, { status: 204 })
})
