import { requestListingDraft, withContext } from '@ecokart/core'
import { getAiModels } from '@/lib/ai'
import { handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { getJobQueue } from '@/lib/queue'
import { requireSeller } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

/**
 * Asks for listing details drawn from a product's photos:
 * `{ "productId": "..." }`. Answers 202 while the worker writes the draft,
 * and 200 with the draft when the same photos were drafted recently.
 */
export const POST = handleErrors(async (request: Request) => {
  const { context } = await requireSeller(request.headers)
  const input = await readJsonBody(request)
  const queue = await getJobQueue()
  const draft = await withContext(getDatabase(), context, (tx) =>
    requestListingDraft(
      tx,
      { storage: getStorage(), queue, ai: getAiModels() },
      context,
      input,
    ),
  )
  return Response.json(
    { draft },
    { status: draft.status === 'succeeded' ? 200 : 202 },
  )
})
