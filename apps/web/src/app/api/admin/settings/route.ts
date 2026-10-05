import { listSettings, withContext } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

/** Every platform setting with its value and where it comes from. */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireAdmin(request.headers)
  const settings = await withContext(getDatabase(), context, (tx) =>
    listSettings(tx, context),
  )
  return Response.json({ settings })
})
