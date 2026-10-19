import { retryFailedJob, withContext } from '@ecokart/core'
import { clientIp, handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { getJobQueue } from '@/lib/queue'
import { requireAdmin } from '@/lib/request-context'

/** Gives a failed job one more attempt. */
export const POST = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/queues/[name]/failed-jobs/[id]/retry'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { name, id } = await route.params
    const queue = await getJobQueue()
    const job = await withContext(getDatabase(), context, (tx) =>
      retryFailedJob(tx, context, queue, name, id, clientIp(request)),
    )
    return Response.json({ job })
  },
)
