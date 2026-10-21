import {
  listSellerStatements,
  requestSellerStatement,
  withContext,
} from '@ecokart/core'
import { clientIp, handleErrors, pageQuery, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { getJobQueue } from '@/lib/queue'
import { requireAdmin } from '@/lib/request-context'

/** The seller's settlement statements, newest first: `?cursor=...&limit=20`. */
export const GET = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/sellers/[id]/settlement-statements'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    const page = await withContext(getDatabase(), context, (tx) =>
      listSellerStatements(tx, context, id, pageQuery(request)),
    )
    return Response.json(page)
  },
)

/**
 * Asks for a statement of the seller's ledger:
 * `{ "from": "2026-10-01", "to": "2026-10-31" }`. Answers 202, because the
 * worker makes the file; follow it with GET /api/settlement-statements/{id}.
 */
export const POST = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/sellers/[id]/settlement-statements'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    const input = await readJsonBody(request)
    const queue = await getJobQueue()
    const statement = await withContext(getDatabase(), context, (tx) =>
      requestSellerStatement(tx, queue, context, id, input, clientIp(request)),
    )
    return Response.json({ statement }, { status: 202 })
  },
)
