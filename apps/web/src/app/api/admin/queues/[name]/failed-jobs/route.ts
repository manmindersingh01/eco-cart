import { listFailedJobs, withContext } from '@ecokart/core'
import { handleErrors, pageQuery } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

/** The queue's failed jobs, most recent failure first: `?cursor=...&limit=20`. */
export const GET = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/queues/[name]/failed-jobs'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { name } = await route.params
    const page = await withContext(getDatabase(), context, (tx) =>
      listFailedJobs(tx, context, name, pageQuery(request)),
    )
    return Response.json(page)
  },
)
