import { getImport, withContext } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireSeller } from '@/lib/request-context'

/** One import: its status, counts, column headings, and first rows. */
export const GET = handleErrors(
  async (request: Request, route: RouteContext<'/api/seller/imports/[id]'>) => {
    const { context } = await requireSeller(request.headers)
    const { id } = await route.params
    const found = await withContext(getDatabase(), context, (tx) =>
      getImport(tx, context, id),
    )
    return Response.json({ import: found })
  },
)
