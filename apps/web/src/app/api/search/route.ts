import {
  consumeSearchAllowance,
  queryObject,
  searchProducts,
  withContext,
} from '@ecokart/core'
import { clientIp, handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { getStorage } from '@/lib/storage'

/**
 * Keyword search, never cached, because each search is logged and limited:
 * `?q=&category=&brand=&minPricePaise=&maxPricePaise=&includeOutOfStock=&sort=&cursor=&limit=`.
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
  const result = await withContext(db, { role: 'anonymous' }, (tx) =>
    searchProducts(tx, getStorage(), query),
  )
  return Response.json(result)
})
