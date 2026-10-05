import { createCategory, getFullCategoryTree, withContext } from '@ecokart/core'
import { clientIp, handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

/** The whole category tree, including inactive categories. */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireAdmin(request.headers)
  const categories = await withContext(getDatabase(), context, (tx) =>
    getFullCategoryTree(tx, context),
  )
  return Response.json({ categories })
})

/** Creates a category. */
export const POST = handleErrors(async (request: Request) => {
  const { context } = await requireAdmin(request.headers)
  const input = await readJsonBody(request)
  const category = await withContext(getDatabase(), context, (tx) =>
    createCategory(tx, context, input, clientIp(request)),
  )
  return Response.json({ category }, { status: 201 })
})
