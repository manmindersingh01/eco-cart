import { deleteCategory, updateCategory, withContext } from '@ecokart/core'
import { clientIp, handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

/** Changes a category; a new `parentId` moves it with its subcategories. */
export const PATCH = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/categories/[id]'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    const input = await readJsonBody(request)
    const category = await withContext(getDatabase(), context, (tx) =>
      updateCategory(tx, context, id, input, clientIp(request)),
    )
    return Response.json({ category })
  },
)

/** Deletes a category with no subcategories and no products. */
export const DELETE = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/categories/[id]'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    await withContext(getDatabase(), context, (tx) =>
      deleteCategory(tx, context, id, clientIp(request)),
    )
    return new Response(null, { status: 204 })
  },
)
