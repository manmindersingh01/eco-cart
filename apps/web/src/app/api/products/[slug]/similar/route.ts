import { handleErrors } from '@/lib/api'
import { readSimilarProducts } from '@/lib/storefront'

/**
 * Up to eight products like this one, in its category and in stock, nearest
 * in meaning first; 404 unless the product is on sale. Cached like the
 * product page.
 */
export const GET = handleErrors(
  async (
    _request: Request,
    route: RouteContext<'/api/products/[slug]/similar'>,
  ) => {
    const { slug } = await route.params
    const similar = await readSimilarProducts(slug)
    return Response.json({ items: similar.items })
  },
)
