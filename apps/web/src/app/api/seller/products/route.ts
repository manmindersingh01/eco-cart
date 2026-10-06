import { createProduct, listOwnProducts, withContext } from '@ecokart/core'
import { handleErrors, pageQuery, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireSeller } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

/** The seller's own products, newest first: `?status=draft&cursor=...`. */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireSeller(request.headers)
  const status = new URL(request.url).searchParams.get('status')
  const page = await withContext(getDatabase(), context, (tx) =>
    listOwnProducts(tx, getStorage(), context, {
      ...(status ? { status } : {}),
      ...pageQuery(request),
    }),
  )
  return Response.json(page)
})

/** Creates a draft listing with its variants. */
export const POST = handleErrors(async (request: Request) => {
  const { context } = await requireSeller(request.headers)
  const input = await readJsonBody(request)
  const product = await withContext(getDatabase(), context, (tx) =>
    createProduct(tx, getStorage(), context, input),
  )
  return Response.json({ product }, { status: 201 })
})
