import { listJobQueues } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getJobQueue } from '@/lib/queue'
import { requireAdmin } from '@/lib/request-context'

/**
 * Every background job queue with how many jobs wait, run, and failed. The
 * counts can trail by about a minute.
 */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireAdmin(request.headers)
  const queues = await listJobQueues(context, await getJobQueue())
  return Response.json({ queues })
})
