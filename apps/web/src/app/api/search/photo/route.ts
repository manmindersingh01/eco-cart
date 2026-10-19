import {
  consumeSearchAllowance,
  queryObject,
  searchByPhoto,
  withContext,
} from '@ecokart/core'
import { getAiModels } from '@/lib/ai'
import { clientIp, handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { getStorage } from '@/lib/storage'

/**
 * Products that look like an uploaded photo, nearest first:
 * `?photo=&category=&brand=&minPricePaise=&maxPricePaise=&includeOutOfStock=&cursor=&limit=`,
 * where `photo` is the key from POST /api/search/photo/uploads. Never
 * cached, because each search is logged and limited.
 */
export const GET = handleErrors(async (request: Request) => {
  const address = clientIp(request)
  const query = queryObject(new URL(request.url).searchParams)
  const db = getDatabase()
  await withContext(db, { role: 'anonymous' }, (tx) =>
    consumeSearchAllowance(tx, address),
  )
  const page = await searchByPhoto(
    { db, storage: getStorage(), ai: getAiModels() },
    query,
  )
  return Response.json(page)
})
