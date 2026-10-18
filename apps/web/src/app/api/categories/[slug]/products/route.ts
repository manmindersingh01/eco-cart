import { queryObject } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { readCategoryPage } from '@/lib/storefront'

/**
 * A category with its breadcrumbs and subcategories, and a page of the
 * products in it and below it:
 * `?brand=&minPricePaise=&maxPricePaise=&includeOutOfStock=&sort=&cursor=&limit=`.
 */
export const GET = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/categories/[slug]/products'>,
  ) => {
    const { slug } = await route.params
    const page = await readCategoryPage(
      slug,
      queryObject(new URL(request.url).searchParams),
    )
    return Response.json(page)
  },
)
