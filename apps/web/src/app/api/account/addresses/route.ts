import { addAddress, listAddresses, withContext } from '@ecokart/core'
import { handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireBuyer } from '@/lib/request-context'

/** The buyer's saved addresses, the default first. */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireBuyer(request.headers)
  const addresses = await withContext(getDatabase(), context, (tx) =>
    listAddresses(tx, context),
  )
  return Response.json({ addresses })
})

/** Saves a new address; the buyer's first one becomes the default. */
export const POST = handleErrors(async (request: Request) => {
  const { context } = await requireBuyer(request.headers)
  const input = await readJsonBody(request)
  const address = await withContext(getDatabase(), context, (tx) =>
    addAddress(tx, context, input),
  )
  return Response.json({ address }, { status: 201 })
})
