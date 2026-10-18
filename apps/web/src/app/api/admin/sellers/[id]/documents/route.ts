import {
  listSellerDocumentRequests,
  requestSellerDocuments,
  withContext,
} from '@ecokart/core'
import { clientIp, handleErrors, pageQuery, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

/**
 * The seller's document requests with their history, newest first:
 * `?show=open&cursor=...&limit=20`. Without `show`, every request.
 */
export const GET = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/sellers/[id]/documents'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    const show = new URL(request.url).searchParams.get('show')
    const page = await withContext(getDatabase(), context, (tx) =>
      listSellerDocumentRequests(tx, context, id, {
        ...(show ? { show } : {}),
        ...pageQuery(request),
      }),
    )
    return Response.json(page)
  },
)

/**
 * Asks the seller for documents:
 * `{ "documents": [{ "type": "gst_certificate", "note": "..." }] }`.
 * Types: gst_certificate, pan_card, bank_proof, business_registration,
 * address_proof, other.
 */
export const POST = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/sellers/[id]/documents'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    const input = await readJsonBody(request)
    const documents = await withContext(getDatabase(), context, (tx) =>
      requestSellerDocuments(tx, context, id, input, clientIp(request)),
    )
    return Response.json({ documents }, { status: 201 })
  },
)
