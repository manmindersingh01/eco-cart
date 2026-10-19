import { getCoupon, updateCoupon, withContext } from '@ecokart/core'
import { clientIp, handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

type Route = RouteContext<'/api/admin/coupons/[id]'>

/** One coupon. */
export const GET = handleErrors(async (request: Request, route: Route) => {
  const { context } = await requireAdmin(request.headers)
  const { id } = await route.params
  const coupon = await withContext(getDatabase(), context, (tx) =>
    getCoupon(tx, context, id),
  )
  return Response.json({ coupon })
})

/** Changes a coupon; `{ "isActive": false }` switches it off. */
export const PATCH = handleErrors(async (request: Request, route: Route) => {
  const { context } = await requireAdmin(request.headers)
  const { id } = await route.params
  const input = await readJsonBody(request)
  const coupon = await withContext(getDatabase(), context, (tx) =>
    updateCoupon(tx, context, id, input, clientIp(request)),
  )
  return Response.json({ coupon })
})
