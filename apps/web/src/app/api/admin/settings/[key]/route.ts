import { updateSetting, ValidationError, withContext } from '@ecokart/core'
import { clientIp, handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

/** Saves one platform setting: `{ "value": ... }`. */
export const PUT = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/settings/[key]'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { key } = await route.params
    const body = await readJsonBody(request)
    if (typeof body !== 'object' || body === null || !('value' in body)) {
      throw new ValidationError('The request body must be { "value": ... }')
    }
    const setting = await withContext(getDatabase(), context, (tx) =>
      updateSetting(tx, context, key, body.value, clientIp(request)),
    )
    return Response.json({ setting })
  },
)
