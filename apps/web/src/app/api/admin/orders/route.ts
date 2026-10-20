import { listAdminOrders, withContext } from '@ecokart/core'
import { handleErrors, pageQuery } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

/**
 * Every order, newest first: `?status=...`, `?needsRefund=true` for paid
 * orders that were cancelled and still need their refund, or
 * `?orderNumber=EK-261018-000123` for one order.
 */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireAdmin(request.headers)
  const query = new URL(request.url).searchParams
  const page = await withContext(getDatabase(), context, (tx) =>
    listAdminOrders(tx, context, {
      ...pageQuery(request),
      status: query.get('status') ?? undefined,
      needsRefund: query.get('needsRefund') === 'true',
      orderNumber: query.get('orderNumber') ?? undefined,
    }),
  )
  return Response.json(page)
})
