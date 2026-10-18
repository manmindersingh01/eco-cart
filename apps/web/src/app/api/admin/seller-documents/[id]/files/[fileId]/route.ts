import { getDocumentDownload } from '@ecokart/core'
import { clientIp, handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

/**
 * Sends the browser to a five-minute signed link to one checked file, so a
 * plain link downloads it. 409 while the worker is still checking it.
 */
export const GET = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/seller-documents/[id]/files/[fileId]'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { id, fileId } = await route.params
    const { url } = await getDocumentDownload(
      { db: getDatabase(), storage: getStorage() },
      context,
      id,
      fileId,
      clientIp(request),
    )
    // The link expires, so no cache may keep the redirect.
    return new Response(null, {
      status: 302,
      headers: { location: url, 'cache-control': 'no-store' },
    })
  },
)
