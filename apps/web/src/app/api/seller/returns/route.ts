import { listSellerReturns, withContext } from '@ecokart/core'
import { handleErrors, pageQuery } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireSeller } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

/**
 * The returns of the seller's lines, newest first:
 * `?status=requested|approved|rejected|refunded&cursor=...&limit=20`.
 */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireSeller(request.headers)
  const status = new URL(request.url).searchParams.get('status') ?? undefined
  const page = await withContext(getDatabase(), context, (tx) =>
    listSellerReturns(tx, context, getStorage(), {
      ...pageQuery(request),
      status,
    }),
  )
  return Response.json(page)
})
