import {
  getSellerBankAccount,
  setSellerBankAccount,
  withContext,
} from '@ecokart/core'
import { clientIp, handleErrors, readJsonBody } from '@/lib/api'
import { getDatabase } from '@/lib/db'
import { getSealingKey } from '@/lib/ledger'
import { requireAdmin } from '@/lib/request-context'

/**
 * The seller's bank account for payouts, with only the last 4 digits of the
 * account number; `null` before one is entered.
 */
export const GET = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/sellers/[id]/bank-account'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    const bankAccount = await withContext(getDatabase(), context, (tx) =>
      getSellerBankAccount(tx, context, id),
    )
    return Response.json({ bankAccount })
  },
)

/**
 * Enters or replaces the seller's bank account:
 * `{ "accountHolder": "...", "accountNumber": "...", "ifsc": "HDFC0001234" }`.
 */
export const PUT = handleErrors(
  async (
    request: Request,
    route: RouteContext<'/api/admin/sellers/[id]/bank-account'>,
  ) => {
    const { context } = await requireAdmin(request.headers)
    const { id } = await route.params
    const input = await readJsonBody(request)
    const bankAccount = await withContext(getDatabase(), context, (tx) =>
      setSellerBankAccount(
        tx,
        getSealingKey(),
        context,
        id,
        input,
        clientIp(request),
      ),
    )
    return Response.json({ bankAccount })
  },
)
