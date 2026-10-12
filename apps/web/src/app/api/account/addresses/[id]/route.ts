import {
  deleteAddress,
  getAddress,
  updateAddress,
  withContext,
} from '@ecokart/core'
import { handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireBuyer } from '@/lib/request-context'

type Route = RouteContext<'/api/account/addresses/[id]'>

/** One of the buyer's saved addresses. */
export const GET = handleErrors(async (request: Request, route: Route) => {
  const { context } = await requireBuyer(request.headers)
  const { id } = await route.params
  const address = await withContext(getDatabase(), context, (tx) =>
    getAddress(tx, context, id),
  )
  return Response.json({ address })
})

/** Changes an address, or makes it the default with `isDefault: true`. */
export const PATCH = handleErrors(async (request: Request, route: Route) => {
  const { context } = await requireBuyer(request.headers)
  const { id } = await route.params
  const input = await readJsonBody(request)
  const address = await withContext(getDatabase(), context, (tx) =>
    updateAddress(tx, context, id, input),
  )
  return Response.json({ address })
})

/** Deletes an address; the newest other one becomes the default if needed. */
export const DELETE = handleErrors(async (request: Request, route: Route) => {
  const { context } = await requireBuyer(request.headers)
  const { id } = await route.params
  await withContext(getDatabase(), context, (tx) =>
    deleteAddress(tx, context, id),
  )
  return new Response(null, { status: 204 })
})
