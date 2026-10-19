import { approveSeller } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { getJobQueue } from '@/lib/queue'
import { requireAdmin } from '@/lib/request-context'
import { getSellerServices } from '@/lib/sellers'

/**
 * Approves a pending seller or seller application. The owner's account gets
 * the seller role, keeping the buyer role of an applicant, and is emailed.
 */
export const POST = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/sellers/[id]/approve'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    return Response.json({
      seller: await approveSeller(getDatabase(), context, id, {
        accounts: getSellerServices().accounts,
        queue: await getJobQueue(),
      }),
    })
  },
)
