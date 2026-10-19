import { rerenderInvoice, withContext } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { getJobQueue } from '@/lib/queue'
import { requireAdmin } from '@/lib/request-context'

/**
 * Has the invoice's PDF made again, for example after the template changed.
 * Answers 202, because the worker makes it afterwards.
 */
export const POST = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/invoices/[id]/render'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    const queue = await getJobQueue()
    const invoice = await withContext(getDatabase(), context, (tx) =>
      rerenderInvoice(tx, queue, context, id),
    )
    return Response.json({ invoice }, { status: 202 })
  },
)
