import { createImportUpload } from '@ecokart/core'
import { handleErrors, readJsonBody } from '@/lib/api'
import { requireSeller } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

/**
 * A signed form for uploading a catalogue file straight to object storage:
 * `{ "fileName": "products.xlsx", "size": 240000 }`.
 */
export const POST = handleErrors(async (request: Request) => {
  const { context } = await requireSeller(request.headers)
  const upload = await createImportUpload(
    getStorage(),
    context,
    await readJsonBody(request),
  )
  return Response.json({ upload }, { status: 201 })
})
