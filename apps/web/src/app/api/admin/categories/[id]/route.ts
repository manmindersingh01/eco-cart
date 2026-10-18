import { deleteCategory, updateCategory, withContext } from '@ecokart/core'
import { revalidateTag } from 'next/cache'
import { clientIp, handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { PUBLIC_CATEGORY_TAG } from '@/lib/public-catalogue'
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
    revalidateTag(PUBLIC_CATEGORY_TAG, 'max')
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
    revalidateTag(PUBLIC_CATEGORY_TAG, 'max')
    return new Response(null, { status: 204 })
  },
)
