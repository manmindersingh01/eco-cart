import { eq } from 'drizzle-orm'
import type { Transaction } from '../../db/client.ts'
import type { RequestContext } from '../../db/context.ts'
import { sellerBankAccounts } from '../../db/schema/index.ts'
import { ConflictError, ForbiddenError, NotFoundError } from '../../errors.ts'
import { openSecret, sealSecret } from '../../lib/encryption.ts'
import { uniqueViolation } from '../../lib/postgres.ts'
import { isUuid, parseInput } from '../../lib/validation.ts'
import { recordAuditEntry } from '../audit/service.ts'
import { getSellerLabels } from '../sellers/service.ts'
import {
  bankAccountInput,
  type BankAccountView,
  type PayoutBankAccount,
} from './types.ts'

/*
 * The bank account each seller's payouts go to (design doc 5.9), which only
 * administrators enter and change. The account number is sealed with
 * MESSAGE_ENCRYPTION_KEY before it reaches the database, and only its last
 * 4 digits are ever shown or logged.
 */

type Administrator = Extract<RequestContext, { role: 'admin' | 'system' }>
type BankAccountRow = typeof sellerBankAccounts.$inferSelect

function assertAdministrator(
  context: RequestContext,
): asserts context is Administrator {
  if (context.role !== 'admin' && context.role !== 'system') {
    throw new ForbiddenError(
      'Only administrators can manage seller bank details',
    )
  }
}

const toView = (row: BankAccountRow): BankAccountView => ({
  sellerId: row.sellerId,
  accountHolder: row.accountHolder,
  accountNumberLast4: row.accountNumberLast4,
  ifsc: row.ifsc,
  updatedAt: row.updatedAt,
})

/** What an audit entry records: never the account number itself. */
const auditable = (row: BankAccountRow) => ({
  accountHolder: row.accountHolder,
  accountNumberLast4: row.accountNumberLast4,
  ifsc: row.ifsc,
})

async function assertSellerExists(
  tx: Transaction,
  sellerId: string,
): Promise<void> {
  if (!isUuid(sellerId) || (await getSellerLabels(tx, [sellerId])).size === 0) {
    throw new NotFoundError('There is no seller with that id')
  }
}

async function findBankAccount(
  tx: Transaction,
  sellerId: string,
  { lock = false } = {},
): Promise<BankAccountRow | null> {
  const query = tx
    .select()
    .from(sellerBankAccounts)
    .where(eq(sellerBankAccounts.sellerId, sellerId))
  const [row] = await (lock ? query.for('update') : query)
  return row ?? null
}

/**
 * An administrator enters or replaces the seller's bank account:
 * `{ accountHolder, accountNumber, ifsc }`. Audited with the last 4 digits
 * and whether the number changed, never the number.
 */
export async function setSellerBankAccount(
  tx: Transaction,
  key: Buffer,
  context: RequestContext,
  sellerId: string,
  input: unknown,
  ip?: string | null,
): Promise<BankAccountView> {
  assertAdministrator(context)
  const details = parseInput(
    bankAccountInput,
    input,
    'Those bank details are not valid',
  )
  await assertSellerExists(tx, sellerId)
  const current = await findBankAccount(tx, sellerId, { lock: true })
  const values = {
    accountHolder: details.accountHolder,
    accountNumberSealed: sealSecret(details.accountNumber, key),
    accountNumberLast4: details.accountNumber.slice(-4),
    ifsc: details.ifsc,
    updatedBy: context.userId ?? null,
  }

  let row: BankAccountRow | undefined
  if (current) {
    ;[row] = await tx
      .update(sellerBankAccounts)
      .set(values)
      .where(eq(sellerBankAccounts.id, current.id))
      .returning()
  } else {
    try {
      ;[row] = await tx
        .insert(sellerBankAccounts)
        .values({ sellerId, ...values })
        .returning()
    } catch (error) {
      if (uniqueViolation(error) === 'seller_bank_accounts_seller_id_unique') {
        throw new ConflictError(
          'Another administrator saved bank details for this seller at the same moment; try again',
        )
      }
      throw error
    }
  }
  const saved = row!
  await recordAuditEntry(tx, {
    actorUserId: context.userId ?? null,
    actorRole: context.role,
    action: 'seller.bank_account.set',
    entityType: 'seller',
    entityId: sellerId,
    before: current ? auditable(current) : null,
    after: {
      ...auditable(saved),
      accountNumberChanged:
        !current ||
        openSecret(current.accountNumberSealed, key) !== details.accountNumber,
    },
    ip,
  })
  return toView(saved)
}

/** The seller's bank account for administrators, or null before it is entered. */
export async function getSellerBankAccount(
  tx: Transaction,
  context: RequestContext,
  sellerId: string,
): Promise<BankAccountView | null> {
  assertAdministrator(context)
  await assertSellerExists(tx, sellerId)
  const row = await findBankAccount(tx, sellerId)
  return row ? toView(row) : null
}

/** The seller's own bank account, or null before an administrator enters it. */
export async function getOwnBankAccount(
  tx: Transaction,
  context: RequestContext,
): Promise<BankAccountView | null> {
  if (context.role !== 'seller') {
    throw new ForbiddenError('This needs a seller account')
  }
  const row = await findBankAccount(tx, context.sellerId)
  return row ? toView(row) : null
}

/**
 * The full account details a payout is made to, for the payout and
 * settlement work of step 15 only. Never return them from the API.
 */
export async function readPayoutBankAccount(
  tx: Transaction,
  key: Buffer,
  context: RequestContext,
  sellerId: string,
): Promise<PayoutBankAccount | null> {
  assertAdministrator(context)
  const row = await findBankAccount(tx, sellerId)
  if (!row) return null
  return {
    accountHolder: row.accountHolder,
    accountNumber: openSecret(row.accountNumberSealed, key),
    ifsc: row.ifsc,
  }
}
