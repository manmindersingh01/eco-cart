import {
  consumeSearchAllowance,
  createSearchPhotoUpload,
  withContext,
} from '@ecokart/core'
import { clientIp, handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { getStorage } from '@/lib/storage'

/**
 * A signed form for uploading a photo to search with, straight to object
 * storage: `{ "contentType": "image/jpeg", "size": 1800000 }`. Counts as a
 * search against the visitor's address.
 */
export const POST = handleErrors(async (request: Request) => {
  const address = clientIp(request)
  const input = await readJsonBody(request)
  await withContext(getDatabase(), { role: 'anonymous' }, (tx) =>
    consumeSearchAllowance(tx, address),
  )
  const upload = await createSearchPhotoUpload(getStorage(), input)
  return Response.json({ upload }, { status: 201 })
})
