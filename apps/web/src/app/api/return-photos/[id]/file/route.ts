import { getReturnPhotoDownload } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { areaOf, requireSignedIn } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

/**
 * Sends the browser to a five-minute signed link to a checked return photo,
 * for the buyer who took it, the seller of the returned item, and
 * administrators. 409 while the worker is still checking it. `?as=seller`
 * from the seller portal (areaOf).
 */
export const GET = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/return-photos/[id]/file'>,
  ) => {
    const { context } = await requireSignedIn(request.headers, areaOf(request))
    const { id } = await route.params
    const { url } = await getReturnPhotoDownload(
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
