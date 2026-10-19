import { addCartItem, withContext } from '@ecokart/core'
import { handleErrors, readJsonBody } from '@/lib/api'
import { requireShopper } from '@/lib/cart'
import { getDatabase } from '@/lib/db'
import { getStorage } from '@/lib/storage'

/** Adds an item, or more of one already in the cart. */
export const POST = handleErrors(async (request: Request) => {
  const { context, finish } = await requireShopper(request, {
    changesCart: true,
  })
  const input = await readJsonBody(request)
  const cart = await withContext(getDatabase(), context, (tx) =>
    addCartItem(tx, context, getStorage(), input),
  )
  return finish(Response.json({ cart }))
})
