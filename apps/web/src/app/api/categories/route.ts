import { connection } from 'next/server'
import { handleErrors } from '@/lib/api'
import { getPublicCategories } from '@/lib/public-catalogue'

/** The visible category tree, for menus and the seller's category picker. */
export const GET = handleErrors(async () => {
  // Read per request; `next build`, which has no database, must not
  // prerender it (Cache Components prerender routes that read no request).
  await connection()
  const categories = await getPublicCategories()
  return Response.json({ categories })
})
