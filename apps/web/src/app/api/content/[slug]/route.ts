import { handleErrors } from '@/lib/api'
import { readContentPage } from '@/lib/storefront'

/**
 * A published policy page in Markdown, for anyone: terms, privacy, shipping,
 * returns, refunds, or seller-agreement. 404 while it is a draft.
 */
export const GET = handleErrors(
  async (_request: Request, route: RouteContext<'/api/content/[slug]'>) => {
    const { slug } = await route.params
    const page = await readContentPage(slug)
    return Response.json({ page })
  },
)
