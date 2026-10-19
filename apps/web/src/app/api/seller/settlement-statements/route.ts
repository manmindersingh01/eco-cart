import {
  listOwnStatements,
  requestOwnStatement,
  withContext,
} from '@ecokart/core'
import { handleErrors, pageQuery, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { getJobQueue } from '@/lib/queue'
import { requireSeller } from '@/lib/request-context'

/** The seller's settlement statements, newest first: `?cursor=...&limit=20`. */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireSeller(request.headers)
  const page = await withContext(getDatabase(), context, (tx) =>
    listOwnStatements(tx, context, pageQuery(request)),
  )
  return Response.json(page)
})

/**
 * Asks for a statement of the seller's ledger:
 * `{ "from": "2026-10-01", "to": "2026-10-31" }`, India dates, both
 * included. Answers 202, because the worker makes the file; follow it with
 * GET /api/settlement-statements/{id}.
 */
export const POST = handleErrors(async (request: Request) => {
  const { context } = await requireSeller(request.headers)
  const input = await readJsonBody(request)
  const queue = await getJobQueue()
  const statement = await withContext(getDatabase(), context, (tx) =>
    requestOwnStatement(tx, queue, context, input),
  )
  return Response.json({ statement }, { status: 202 })
})
