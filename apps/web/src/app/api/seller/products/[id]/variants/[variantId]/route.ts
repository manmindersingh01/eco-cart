import { deleteVariant, updateVariant, withContext } from '@ecokart/core'
import { handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireSeller } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

type Route = RouteContext<'/api/seller/products/[id]/variants/[variantId]'>

/** Changes a variant: price, MRP, stock, and active at any time. */
export const PATCH = handleErrors(async (request: Request, route: Route) => {
  const { context } = await requireSeller(request.headers)
  const { id, variantId } = await route.params
  const input = await readJsonBody(request)
  const product = await withContext(getDatabase(), context, (tx) =>
    updateVariant(tx, getStorage(), context, id, variantId, input),
  )
  return Response.json({ product })
})

/** Deletes a variant that no order or cart refers to. */
export const DELETE = handleErrors(async (request: Request, route: Route) => {
  const { context } = await requireSeller(request.headers)
  const { id, variantId } = await route.params
  const product = await withContext(getDatabase(), context, (tx) =>
    deleteVariant(tx, getStorage(), context, id, variantId),
  )
  return Response.json({ product })
})
