import { listReturns, withContext } from '@ecokart/core'
import { handleErrors, pageQuery } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

/**
 * Returns in one status, `requested` by default: those waiting for a
 * decision or a refund come oldest first. `?status=...&cursor=...&limit=20`.
 */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireAdmin(request.headers)
  const status = new URL(request.url).searchParams.get('status') ?? undefined
  const page = await withContext(getDatabase(), context, (tx) =>
    listReturns(tx, context, getStorage(), { ...pageQuery(request), status }),
  )
  return Response.json(page)
})
