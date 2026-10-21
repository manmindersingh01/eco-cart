import { getInvoiceDownload } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { areaOf, requireSignedIn } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

/**
 * Sends the browser to a five-minute signed link to the invoice PDF, so a
 * plain link downloads it. 409 while the worker is still making the PDF.
 * `?as=seller` from the seller portal (areaOf).
 */
export const GET = handleErrors(
  async (request: Request, route: RouteContext<'/api/invoices/[id]/pdf'>) => {
    const { context } = await requireSignedIn(request.headers, areaOf(request))
    const { id } = await route.params
    const { url } = await getInvoiceDownload(
      { db: getDatabase(), storage: getStorage() },
      context,
      id,
    )
    // The link expires, so no cache may keep the redirect.
    return new Response(null, {
      status: 302,
      headers: { location: url, 'cache-control': 'no-store' },
    })
  },
)
