import { handleErrors } from '@/lib/api'
import { getPublicCategories } from '@/lib/public-catalogue'

/** The visible category tree, for menus and the seller's category picker. */
export const GET = handleErrors(async () => {
  const categories = await getPublicCategories()
  return Response.json({ categories })
})
