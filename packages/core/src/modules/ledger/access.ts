import type { Transaction } from '../../db/client.ts'
import type { RequestContext } from '../../db/context.ts'
import { ForbiddenError, NotFoundError } from '../../errors.ts'
import { isUuid } from '../../lib/validation.ts'
import { getSellerLabels } from '../sellers/service.ts'

/* Who may do what with seller money (design doc 5.9). */

export type Administrator = Extract<
  RequestContext,
  { role: 'admin' | 'system' }
>
export type Seller = Extract<RequestContext, { role: 'seller' }>

/** `what` ends the message "Only administrators can ...". */
export function assertAdministrator(
  context: RequestContext,
  what: string,
): asserts context is Administrator {
  if (context.role !== 'admin' && context.role !== 'system') {
    throw new ForbiddenError(`Only administrators can ${what}`)
  }
}

export function assertSeller(
  context: RequestContext,
): asserts context is Seller {
  if (context.role !== 'seller') {
    throw new ForbiddenError('This needs a seller account')
  }
}

export async function assertSellerExists(
  tx: Transaction,
  sellerId: string,
): Promise<void> {
  if (!isUuid(sellerId) || (await getSellerLabels(tx, [sellerId])).size === 0) {
    throw new NotFoundError('There is no seller with that id')
  }
}
