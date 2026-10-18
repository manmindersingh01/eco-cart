import { queryObject, withContext, writeReview } from '@ecokart/core'
import { handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireBuyer } from '@/lib/request-context'
import { readProductReviews } from '@/lib/storefront'

/** The product's published reviews, newest first: `?cursor=&limit=`. */
export const GET = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/products/[slug]/reviews'>,
  ) => {
    const { slug } = await route.params
    const page = await readProductReviews(
      slug,
      queryObject(new URL(request.url).searchParams),
    )
    return Response.json(page)
  },
)

/**
 * A buyer's review of the product, once:
 * `{ "rating": 5, "authorName": "Priya S.", "title": "...", "body": "..." }`.
 */
export const POST = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/products/[slug]/reviews'>,
  ) => {
    const { context } = await requireBuyer(request.headers)
    const { slug } = await route.params
    const input = await readJsonBody(request)
    const review = await withContext(getDatabase(), context, (tx) =>
      writeReview(tx, context, slug, input),
    )
    return Response.json({ review }, { status: 201 })
  },
)
