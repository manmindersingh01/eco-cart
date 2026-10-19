import { listReviewQueue, withContext } from '@ecokart/core'
import { handleErrors, pageQuery } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

/**
 * Listings waiting for review, highest risk first, then oldest first:
 * `?risk=high&cursor=...&limit=20`.
 */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireAdmin(request.headers)
  const risk = new URL(request.url).searchParams.get('risk')
  const page = await withContext(getDatabase(), context, (tx) =>
    listReviewQueue(tx, getStorage(), context, {
      ...(risk ? { risk } : {}),
      ...pageQuery(request),
    }),
  )
  return Response.json(page)
})
