import { listDocumentsToReview, withContext } from '@ecokart/core'
import { handleErrors, pageQuery } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

/**
 * Seller documents waiting for review across every seller, oldest upload
 * first: `?cursor=...&limit=20`.
 */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireAdmin(request.headers)
  const page = await withContext(getDatabase(), context, (tx) =>
    listDocumentsToReview(tx, context, pageQuery(request)),
  )
  return Response.json(page)
})
