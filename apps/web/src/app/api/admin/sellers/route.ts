import { createSeller, listSellers } from '@ecokart/core'
import { handleErrors, pageQuery, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'
import { getSellerServices } from '@/lib/sellers'

/** Sellers newest first: `?status=pending&cursor=...&limit=20`. */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireAdmin(request.headers)
  const status = new URL(request.url).searchParams.get('status')
  const page = await listSellers(getDatabase(), context, {
    ...(status ? { status } : {}),
    ...pageQuery(request),
  })
  return Response.json(page)
})

/** Creates a seller business and its owner's sign-in account. */
export const POST = handleErrors(async (request: Request) => {
  const { context } = await requireAdmin(request.headers)
  const seller = await createSeller(
    getSellerServices(),
    context,
    await readJsonBody(request),
  )
  return Response.json({ seller }, { status: 201 })
})
