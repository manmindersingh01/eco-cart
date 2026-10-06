import { createImageUpload } from '@ecokart/core'
import { handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireSeller } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

/**
 * A signed form for uploading one photo straight to object storage:
 * `{ "contentType": "image/jpeg", "size": 2400000 }`.
 */
export const POST = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/seller/products/[id]/images/uploads'>,
  ) => {
    const { context } = await requireSeller(request.headers)
    const { id } = await route.params
    const upload = await createImageUpload(
      { db: getDatabase(), storage: getStorage() },
      context,
      id,
      await readJsonBody(request),
    )
    return Response.json({ upload }, { status: 201 })
  },
)
