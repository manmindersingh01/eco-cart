import { handleErrors } from '@/lib/api'
import { readProductPage } from '@/lib/storefront'

/** One product page, for anyone; 404 unless the product is on sale. */
export const GET = handleErrors(
  async (_request: Request, route: RouteContext<'/api/products/[slug]'>) => {
    const { slug } = await route.params
    const product = await readProductPage(slug)
    return Response.json({ product })
  },
)
