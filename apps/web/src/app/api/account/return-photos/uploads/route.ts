import { createReturnPhotoUpload } from '@ecokart/core'
import { handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireBuyer } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

/**
 * A signed form for uploading one return photo straight to object storage:
 * `{ "contentType": "image/jpeg", "size": 2400000 }`.
 */
export const POST = handleErrors(async (request: Request) => {
  const { context } = await requireBuyer(request.headers)
  const upload = await createReturnPhotoUpload(
    { db: getDatabase(), storage: getStorage() },
    context,
    await readJsonBody(request),
  )
  return Response.json({ upload }, { status: 201 })
})
