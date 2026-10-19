import { getSettlementStatement, withContext } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireSignedIn } from '@/lib/request-context'

/**
 * One settlement statement, for its seller and administrators, to follow
 * the worker until its status is `ready` or `failed`.
 */
export const GET = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/settlement-statements/[id]'>,
  ) => {
    const { context } = await requireSignedIn(request.headers)
    const { id } = await route.params
    const statement = await withContext(getDatabase(), context, (tx) =>
      getSettlementStatement(tx, context, id),
    )
    return Response.json({ statement })
  },
)
