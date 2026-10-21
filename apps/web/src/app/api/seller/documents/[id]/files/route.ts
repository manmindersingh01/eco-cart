import { addDocumentFile, withContext } from '@ecokart/core'
import { handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { getJobQueue } from '@/lib/queue'
import { requireSeller } from '@/lib/request-context'

/**
 * Adds an uploaded file: `{ "uploadKey": "uploads/seller-documents/..." }`.
 * Answers 202, because the worker checks the file afterwards.
 */
export const POST = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/seller/documents/[id]/files'>,
  ) => {
    const { context } = await requireSeller(request.headers, {
      // An applicant sends the documents an administrator asked for.
      applicants: true,
    })
    const { id } = await route.params
    const input = await readJsonBody(request)
    const queue = await getJobQueue()
    const document = await withContext(getDatabase(), context, (tx) =>
      addDocumentFile(tx, queue, context, id, input),
    )
    return Response.json({ document }, { status: 202 })
  },
)
