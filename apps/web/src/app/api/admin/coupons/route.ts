import { createCoupon, listCoupons, withContext } from '@ecokart/core'
import { clientIp, handleErrors, pageQuery, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

/** Every coupon, newest first: `?cursor=...&limit=20`. */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireAdmin(request.headers)
  const page = await withContext(getDatabase(), context, (tx) =>
    listCoupons(tx, context, pageQuery(request)),
  )
  return Response.json(page)
})

/** Creates a coupon. */
export const POST = handleErrors(async (request: Request) => {
  const { context } = await requireAdmin(request.headers)
  const input = await readJsonBody(request)
  const coupon = await withContext(getDatabase(), context, (tx) =>
    createCoupon(tx, context, input, clientIp(request)),
  )
  return Response.json({ coupon }, { status: 201 })
})
