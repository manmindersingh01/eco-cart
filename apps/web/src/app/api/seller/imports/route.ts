import { createImport, listImports, withContext } from '@ecokart/core'
import { handleErrors, pageQuery, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { getJobQueue } from '@/lib/queue'
import { requireSeller } from '@/lib/request-context'

/** The seller's imports, newest first: `?cursor=...`. */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireSeller(request.headers)
  const page = await withContext(getDatabase(), context, (tx) =>
    listImports(tx, context, pageQuery(request)),
  )
  return Response.json(page)
})

/**
 * Starts an import from an uploaded file:
 * `{ "uploadKey": "uploads/...", "fileName": "products.xlsx" }`. Answers 202,
 * because the worker reads the file afterwards.
 */
export const POST = handleErrors(async (request: Request) => {
  const { context } = await requireSeller(request.headers)
  const input = await readJsonBody(request)
  const queue = await getJobQueue()
  const created = await withContext(getDatabase(), context, (tx) =>
    createImport(tx, queue, context, input),
  )
  return Response.json({ import: created }, { status: 202 })
})
