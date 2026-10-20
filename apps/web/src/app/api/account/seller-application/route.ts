import {
  applyToSell,
  getOwnApplication,
  updateOwnApplication,
} from '@ecokart/core'
import { handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { requireBuyer, requireSignedIn } from '@/lib/request-context'

/**
 * The account's application to sell, with its status, or the seller
 * business it became: `pending`, `rejected` with `rejectionReason`,
 * `approved`, or `suspended`. 404 before applying.
 */
export const GET = handleErrors(async (request: Request) => {
  const { context } = await requireSignedIn(request.headers)
  return Response.json({
    application: await getOwnApplication(getDatabase(), context),
  })
})

/**
 * Applies to sell with the business details, or sends a rejected
 * application again: `{ "displayName", "legalName", "gstin", "pan",
 * "line1", "city", "stateCode", "pincode", "supportEmail", "supportPhone" }`
 * and optionally `"invoicePrefix"`. The buyer keeps shopping meanwhile.
 */
export const POST = handleErrors(async (request: Request) => {
  const { context } = await requireBuyer(request.headers)
  const application = await applyToSell(
    getDatabase(),
    context,
    await readJsonBody(request),
  )
  return Response.json({ application }, { status: 201 })
})

/** Changes any of those details while the application is open. */
export const PATCH = handleErrors(async (request: Request) => {
  const { context } = await requireBuyer(request.headers)
  const application = await updateOwnApplication(
    getDatabase(),
    context,
    await readJsonBody(request),
  )
  return Response.json({ application })
})
