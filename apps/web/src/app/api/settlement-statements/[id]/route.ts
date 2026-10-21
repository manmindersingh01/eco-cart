import { getSettlementStatement, withContext } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { areaOf, requireSignedIn } from '@/lib/request-context'

/**
 * One settlement statement, for its seller and administrators, to follow
 * the worker until its status is `ready` or `failed`.
 * Combined accounts select their seller area with `?as=seller`.
 */
export const GET = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/settlement-statements/[id]'>,
  ) => {
    const { context } = await requireSignedIn(request.headers, areaOf(request))
    const { id } = await route.params
    const statement = await withContext(getDatabase(), context, (tx) =>
      getSettlementStatement(tx, context, id),
    )
    return Response.json({ statement })
  },
)
