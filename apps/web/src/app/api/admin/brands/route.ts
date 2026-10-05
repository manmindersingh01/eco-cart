import { createBrand, listAllBrands, withContext } from '@ecokart/core'
import { clientIp, handleErrors, pageQuery, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

/** Every brand A to Z, active or not: `?q=bamboo&cursor=...&limit=20`. */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireAdmin(request.headers)
  const q = new URL(request.url).searchParams.get('q')
  const page = await withContext(getDatabase(), context, (tx) =>
    listAllBrands(tx, context, { ...(q ? { q } : {}), ...pageQuery(request) }),
  )
  return Response.json(page)
})

/** Creates a brand. */
export const POST = handleErrors(async (request: Request) => {
  const { context } = await requireAdmin(request.headers)
  const input = await readJsonBody(request)
  const brand = await withContext(getDatabase(), context, (tx) =>
    createBrand(tx, context, input, clientIp(request)),
  )
  return Response.json({ brand }, { status: 201 })
})
