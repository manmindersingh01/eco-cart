import { getCart, withContext } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { requireShopper } from '@/lib/cart'
import { getDatabase } from '@/lib/db'
import { getStorage } from '@/lib/storage'

/** The visitor's cart, priced fresh; empty for a new visitor. */
export const GET = handleErrors(async (request: Request) => {
  const { context, finish } = await requireShopper(request)
  const cart = await withContext(getDatabase(), context, (tx) =>
    getCart(tx, context, getStorage()),
  )
  return finish(Response.json({ cart }))
})
