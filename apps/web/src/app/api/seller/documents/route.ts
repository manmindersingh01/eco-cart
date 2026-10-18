import { listOwnDocumentRequests, withContext } from '@ecokart/core'
import { handleErrors, pageQuery } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireSeller } from '@/lib/request-context'

/**
 * The documents administrators asked this seller for, newest first:
 * `?show=open` (the default) or `?show=all`, with `cursor` and `limit`.
 */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireSeller(request.headers)
  const show = new URL(request.url).searchParams.get('show')
  const page = await withContext(getDatabase(), context, (tx) =>
    listOwnDocumentRequests(tx, context, {
      ...(show ? { show } : {}),
      ...pageQuery(request),
    }),
  )
  return Response.json(page)
})
