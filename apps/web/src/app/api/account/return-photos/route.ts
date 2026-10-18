import { addReturnPhoto, withContext } from '@ecokart/core'
import { handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { getJobQueue } from '@/lib/queue'
import { requireBuyer } from '@/lib/request-context'

/**
 * Adds an uploaded return photo: `{ "uploadKey": "uploads/returns/..." }`.
 * Answers 202, because the worker checks the photo afterwards; follow it
 * with GET /api/account/return-photos/{id}.
 */
export const POST = handleErrors(async (request: Request) => {
  const { context } = await requireBuyer(request.headers)
  const input = await readJsonBody(request)
  const queue = await getJobQueue()
  const photo = await withContext(getDatabase(), context, (tx) =>
    addReturnPhoto(tx, queue, context, input),
  )
  return Response.json({ photo }, { status: 202 })
})
