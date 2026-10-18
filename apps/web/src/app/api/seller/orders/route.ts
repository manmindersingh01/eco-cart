import { listSellerOrders, withContext } from '@ecokart/core'
import { handleErrors, pageQuery } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireSeller } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

/**
 * The seller's orders in one tab, with only their own lines:
 * `?tab=to_dispatch|dispatched|delivered|cancelled&cursor=...&limit=20`.
 */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireSeller(request.headers)
  const tab = new URL(request.url).searchParams.get('tab') ?? undefined
  const page = await withContext(getDatabase(), context, (tx) =>
    listSellerOrders(tx, context, getStorage(), {
      ...pageQuery(request),
      tab,
    }),
  )
  return Response.json(page)
})
