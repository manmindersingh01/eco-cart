import { removeCartItem, setCartItemQuantity, withContext } from '@ecokart/core'
import { handleErrors, readJsonBody } from '@/lib/api'
import { requireShopper } from '@/lib/cart'
import { getDatabase } from '@/lib/db'
import { getStorage } from '@/lib/storage'

type Route = RouteContext<'/api/cart/items/[variantId]'>

/** Sets how many of an item the cart holds: `{ "quantity": 3 }`. */
export const PATCH = handleErrors(async (request: Request, route: Route) => {
  const { context, finish } = await requireShopper(request, {
    changesCart: true,
  })
  const { variantId } = await route.params
  const input = await readJsonBody(request)
  const cart = await withContext(getDatabase(), context, (tx) =>
    setCartItemQuantity(tx, context, getStorage(), variantId, input),
  )
  return finish(Response.json({ cart }))
})

/** Takes an item out of the cart. */
export const DELETE = handleErrors(async (request: Request, route: Route) => {
  const { context, finish } = await requireShopper(request, {
    changesCart: true,
  })
  const { variantId } = await route.params
  const cart = await withContext(getDatabase(), context, (tx) =>
    removeCartItem(tx, context, getStorage(), variantId),
  )
  return finish(Response.json({ cart }))
})
