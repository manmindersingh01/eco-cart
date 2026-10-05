import { listBrands, withContext } from '@ecokart/core'
import { handleErrors, pageQuery } from '@/lib/api'
import { getDatabase } from '@/lib/db'

/** Active brands A to Z: `?q=bamboo&cursor=...&limit=20`. */
export const GET = handleErrors(async (request: Request) => {
  const q = new URL(request.url).searchParams.get('q')
  const page = await withContext(getDatabase(), { role: 'anonymous' }, (tx) =>
    listBrands(tx, { ...(q ? { q } : {}), ...pageQuery(request) }),
  )
  return Response.json(page)
})
