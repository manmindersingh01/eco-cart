import { listOwnInvoices, withContext } from '@ecokart/core'
import { handleErrors, pageQuery } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireSeller } from '@/lib/request-context'

/** The seller's own invoices, newest first: `?cursor=...&limit=20`. */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireSeller(request.headers)
  const page = await withContext(getDatabase(), context, (tx) =>
    listOwnInvoices(tx, context, pageQuery(request)),
  )
  return Response.json(page)
})
