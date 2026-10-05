import { getOwnSeller, updateOwnContacts } from '@ecokart/core'
import { handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireSeller } from '@/lib/request-context'

/** The signed-in seller's own business details. */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireSeller(request.headers)
  return Response.json({ seller: await getOwnSeller(getDatabase(), context) })
})

/** The seller changes their display name and support contacts. */
export const PATCH = handleErrors(async (request: Request) => {
  const { context } = await requireSeller(request.headers)
  const seller = await updateOwnContacts(
    getDatabase(),
    context,
    await readJsonBody(request),
  )
  return Response.json({ seller })
})
