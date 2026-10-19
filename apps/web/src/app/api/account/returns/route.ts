import { listOwnReturns, openReturn, withContext } from '@ecokart/core'
import { handleErrors, pageQuery, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireBuyer } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

/** The buyer's returns, newest first: `?cursor=...&limit=20`. */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireBuyer(request.headers)
  const page = await withContext(getDatabase(), context, (tx) =>
    listOwnReturns(tx, context, getStorage(), pageQuery(request)),
  )
  return Response.json(page)
})

/**
 * Asks to return a delivered line: `{ "orderItemId", "quantity"?,
 * "reasonCode", "reasonText"?, "photoIds"? }`.
 */
export const POST = handleErrors(async (request: Request) => {
  const { context } = await requireBuyer(request.headers)
  const input = await readJsonBody(request)
  const created = await openReturn(
    getDatabase(),
    { photos: getStorage() },
    context,
    input,
  )
  return Response.json({ return: created }, { status: 201 })
})
