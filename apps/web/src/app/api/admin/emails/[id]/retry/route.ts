import { retryEmail, withContext } from '@ecokart/core'
import { clientIp, handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { getJobQueue } from '@/lib/queue'
import { requireAdmin } from '@/lib/request-context'

/** Puts a failed or stuck email back in the queue with fresh attempts. */
export const POST = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/emails/[id]/retry'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    const queue = await getJobQueue()
    const email = await withContext(getDatabase(), context, (tx) =>
      retryEmail(tx, context, queue, id, clientIp(request)),
    )
    return Response.json({ email })
  },
)
