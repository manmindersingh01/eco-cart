import { listOrderInvoices, ValidationError, withContext } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { areaOf, requireSignedIn } from '@/lib/request-context'

/**
 * The invoices of one order the caller may see: `?orderId=...`. The buyer
 * and administrators get every seller's invoice, a seller only their own,
 * with `&as=seller` from the seller portal (areaOf).
 */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireSignedIn(request.headers, areaOf(request))
  const orderId = new URL(request.url).searchParams.get('orderId')
  if (!orderId) throw new ValidationError('orderId is required')
  const invoices = await withContext(getDatabase(), context, (tx) =>
    listOrderInvoices(tx, context, orderId),
  )
  return Response.json({ invoices })
})
