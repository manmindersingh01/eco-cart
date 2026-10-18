import { getImportErrorReport } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireSeller } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

/**
 * Sends the browser to a five-minute signed link to the CSV of rows that
 * could not be imported, so a plain link downloads it. 409 until the import
 * has finished, or when every row was imported.
 */
export const GET = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/seller/imports/[id]/error-report'>,
  ) => {
    const { context } = await requireSeller(request.headers)
    const { id } = await route.params
    const { url } = await getImportErrorReport(
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
