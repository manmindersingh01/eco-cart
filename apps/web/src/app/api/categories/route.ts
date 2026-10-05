import { getCategoryTree, withContext } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'

/** The visible category tree, for menus and the seller's category picker. */
export const GET = handleErrors(async () => {
  const categories = await withContext(
    getDatabase(),
    { role: 'anonymous' },
    (tx) => getCategoryTree(tx),
  )
  return Response.json({ categories })
})
