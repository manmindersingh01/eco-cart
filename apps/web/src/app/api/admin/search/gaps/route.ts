import { listSearchGaps, queryObject, withContext } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

/** The catalogue gap report: searches that found nothing, `?days=30`. */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireAdmin(request.headers)
  const gaps = await withContext(getDatabase(), context, (tx) =>
    listSearchGaps(tx, context, queryObject(new URL(request.url).searchParams)),
  )
  return Response.json({ gaps })
})
