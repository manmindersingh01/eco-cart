import {
  consumeSearchAllowance,
  naturalSearch,
  queryObject,
  withContext,
} from '@ecokart/core'
import { getAiModels } from '@/lib/ai'
import { clientIp, handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { getStorage } from '@/lib/storage'

/**
 * Search by a sentence, such as "a steel bottle under 500 rupees":
 * `?q=&category=&brand=&minPricePaise=&maxPricePaise=&includeOutOfStock=&cursor=&limit=`.
 * Products come nearest in meaning first, or from a keyword search when AI
 * cannot help; `understood` says what the sentence was taken to mean. Never
 * cached, because each search is logged and limited.
 */
export const GET = handleErrors(async (request: Request) => {
  // Reading the request first also keeps `next build` from prerendering it.
  const address = clientIp(request)
  const query = queryObject(new URL(request.url).searchParams)
  const db = getDatabase()
  // Its own transaction, so the count's row lock is released at once.
  await withContext(db, { role: 'anonymous' }, (tx) =>
    consumeSearchAllowance(tx, address),
  )
  const result = await naturalSearch(
    { db, photos: getStorage(), ai: getAiModels() },
    query,
  )
  return Response.json(result)
})
