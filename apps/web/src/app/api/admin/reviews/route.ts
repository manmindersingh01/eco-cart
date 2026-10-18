import { listReviews, withContext } from '@ecokart/core'
import { handleErrors, pageQuery } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

/** Reviews newest first: `?status=published|hidden&cursor=&limit=`. */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireAdmin(request.headers)
  const status = new URL(request.url).searchParams.get('status')
  const page = await withContext(getDatabase(), context, (tx) =>
    listReviews(tx, context, {
      ...(status ? { status } : {}),
      ...pageQuery(request),
    }),
  )
  return Response.json(page)
})
