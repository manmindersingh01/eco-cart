import { listContentPages, withContext } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

/** Every policy page, also those nobody has written yet. */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireAdmin(request.headers)
  const pages = await withContext(getDatabase(), context, (tx) =>
    listContentPages(tx, context),
  )
  return Response.json({ pages })
})
