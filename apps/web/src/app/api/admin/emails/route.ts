import { listUndeliveredEmails, withContext } from '@ecokart/core'
import { handleErrors, pageQuery } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

/**
 * Emails that failed or are stuck in the queue, newest first:
 * `?state=failed|stuck&cursor=...&limit=20`. Without `state`, both.
 */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireAdmin(request.headers)
  const state = new URL(request.url).searchParams.get('state')
  const page = await withContext(getDatabase(), context, (tx) =>
    listUndeliveredEmails(tx, context, {
      ...pageQuery(request),
      ...(state === null ? {} : { state }),
    }),
  )
  return Response.json(page)
})
