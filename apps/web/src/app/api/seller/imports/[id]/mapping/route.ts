import { setImportMapping, withContext } from '@ecokart/core'
import { handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { getJobQueue } from '@/lib/queue'
import { requireSeller } from '@/lib/request-context'

/**
 * Says which column fills which field and starts the import:
 * `{ "columnMapping": { "Product Name": "title", "Price (Rs)": "price" } }`.
 * Answers 202, because the worker makes the drafts afterwards.
 */
export const PUT = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/seller/imports/[id]/mapping'>,
  ) => {
    const { context } = await requireSeller(request.headers)
    const { id } = await route.params
    const input = await readJsonBody(request)
    const queue = await getJobQueue()
    const updated = await withContext(getDatabase(), context, (tx) =>
      setImportMapping(tx, queue, context, id, input),
    )
    return Response.json({ import: updated }, { status: 202 })
  },
)
