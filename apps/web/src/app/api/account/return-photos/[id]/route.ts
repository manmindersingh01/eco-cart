import { getReturnPhoto, withContext } from '@ecokart/core'
import { handleErrors } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireBuyer } from '@/lib/request-context'

/** One of the buyer's return photos: processing, ready, or failed with why. */
export const GET = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/account/return-photos/[id]'>,
  ) => {
    const { context } = await requireBuyer(request.headers)
    const { id } = await route.params
    const photo = await withContext(getDatabase(), context, (tx) =>
      getReturnPhoto(tx, context, id),
    )
    return Response.json({ photo })
  },
)
