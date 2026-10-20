import { createDocumentUpload } from '@ecokart/core'
import { handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireSeller } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

/**
 * A signed form for uploading one file straight to object storage:
 * `{ "contentType": "application/pdf", "size": 250000 }`. PDF, JPEG, or
 * PNG, at most 10 MB.
 */
export const POST = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/seller/documents/[id]/uploads'>,
  ) => {
    const { context } = await requireSeller(request.headers, {
      // An applicant sends the documents an administrator asked for.
      applicants: true,
    })
    const { id } = await route.params
    const upload = await createDocumentUpload(
      { db: getDatabase(), storage: getStorage() },
      context,
      id,
      await readJsonBody(request),
    )
    return Response.json({ upload }, { status: 201 })
  },
)
