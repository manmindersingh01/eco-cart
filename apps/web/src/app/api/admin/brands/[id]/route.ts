import { deleteBrand, updateBrand, withContext } from '@ecokart/core'
import { clientIp, handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

/** Changes a brand's name, slug, or whether it is active. */
export const PATCH = handleErrors(
  async (request: Request, route: RouteContext<'/api/admin/brands/[id]'>) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    const input = await readJsonBody(request)
    const brand = await withContext(getDatabase(), context, (tx) =>
      updateBrand(tx, context, id, input, clientIp(request)),
    )
    return Response.json({ brand })
  },
)

/** Deletes a brand that no product uses. */
export const DELETE = handleErrors(
  async (request: Request, route: RouteContext<'/api/admin/brands/[id]'>) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    await withContext(getDatabase(), context, (tx) =>
      deleteBrand(tx, context, id, clientIp(request)),
    )
    return new Response(null, { status: 204 })
  },
)
