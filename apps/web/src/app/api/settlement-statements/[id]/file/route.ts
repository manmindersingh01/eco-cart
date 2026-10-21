import { getSettlementStatementDownload } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireSignedIn } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

/**
 * Sends the browser to a five-minute signed link to the statement's CSV,
 * for its seller and administrators. 409 while the worker is making it.
 */
export const GET = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/settlement-statements/[id]/file'>,
  ) => {
    // Statements belong to sellers, so an account that also buys acts as
    // its seller here; administrators act as themselves in any area.
    const { context } = await requireSignedIn(request.headers, 'seller')
    const { id } = await route.params
    const { url } = await getSettlementStatementDownload(
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
