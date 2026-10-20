import { rejectSeller } from '@ecokart/core'
import { handleErrors, readJsonBody } from '@/lib/api'
import { getJobQueue } from '@/lib/queue'
import { requireAdmin } from '@/lib/request-context'
import { getSellerServices } from '@/lib/sellers'

/**
 * Rejects a seller application waiting for review: `{ "reason": "..." }`.
 * The applicant is emailed the reason and may apply again.
 */
export const POST = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/sellers/[id]/reject'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    const seller = await rejectSeller(
      { ...getSellerServices(), queue: await getJobQueue() },
      context,
      id,
      await readJsonBody(request),
    )
    return Response.json({ seller })
  },
)
