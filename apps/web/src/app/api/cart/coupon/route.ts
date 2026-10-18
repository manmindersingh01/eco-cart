import { applyCoupon, removeCoupon, withContext } from '@ecokart/core'
import { clientIp, handleErrors, readJsonBody } from '@/lib/api'
import { requireShopper } from '@/lib/cart'
import { getDatabase } from '@/lib/db'
import { getStorage } from '@/lib/storage'

/** Uses a coupon on the cart: `{ "code": "DIWALI25" }`. */
export const PUT = handleErrors(async (request: Request) => {
  const { context, finish } = await requireShopper(request, {
    changesCart: true,
  })
  const input = await readJsonBody(request)
  const cart = await applyCoupon(
    getDatabase(),
    context,
    getStorage(),
    input,
    clientIp(request),
  )
  return finish(Response.json({ cart }))
})

/** Takes the coupon off the cart. */
export const DELETE = handleErrors(async (request: Request) => {
  const { context, finish } = await requireShopper(request, {
    changesCart: true,
  })
  const cart = await withContext(getDatabase(), context, (tx) =>
    removeCoupon(tx, context, getStorage()),
  )
  return finish(Response.json({ cart }))
})
