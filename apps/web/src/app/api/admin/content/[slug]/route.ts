import { getContentPage, saveContentPage, withContext } from '@ecokart/core'
import { clientIp, handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

/** One policy page as administrators see it. */
export const GET = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/content/[slug]'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { slug } = await route.params
    const page = await withContext(getDatabase(), context, (tx) =>
      getContentPage(tx, context, slug),
    )
    return Response.json({ page })
  },
)

/**
 * Saves a page:
 * `{ "title": "Returns policy", "bodyMarkdown": "...", "status": "published" }`.
 */
export const PUT = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/content/[slug]'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { slug } = await route.params
    const input = await readJsonBody(request)
    const page = await withContext(getDatabase(), context, (tx) =>
      saveContentPage(tx, context, slug, input, clientIp(request)),
    )
    return Response.json({ page })
  },
)
