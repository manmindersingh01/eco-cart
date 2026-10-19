import { listBuyerOrders, withContext } from '@ecokart/core'
import { handleErrors, pageQuery } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireBuyer } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

/** The buyer's orders, newest first: `?cursor=...&limit=20`. */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireBuyer(request.headers)
  const page = await withContext(getDatabase(), context, (tx) =>
    listBuyerOrders(tx, context, getStorage(), pageQuery(request)),
  )
  return Response.json(page)
})
