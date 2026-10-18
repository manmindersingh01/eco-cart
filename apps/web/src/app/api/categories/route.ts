import { getCategoryTree, withContext } from '@ecokart/core'
import { connection } from 'next/server'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'

/** The visible category tree, for menus and the seller's category picker. */
export const GET = handleErrors(async () => {
  // Read per request; `next build`, which has no database, must not
  // prerender it (Cache Components prerender routes that read no request).
  await connection()
  const categories = await withContext(
    getDatabase(),
    { role: 'anonymous' },
    (tx) => getCategoryTree(tx),
  )
  return Response.json({ categories })
})
