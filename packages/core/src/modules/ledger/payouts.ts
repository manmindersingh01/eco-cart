import { and, eq } from 'drizzle-orm'
import type { Transaction } from '../../db/client.ts'
import type { RequestContext } from '../../db/context.ts'
import { sellerLedgerEntries } from '../../db/schema/index.ts'
import { ConflictError, ValidationError } from '../../errors.ts'
import { formatRupees } from '../../lib/money.ts'
import { uniqueViolation } from '../../lib/postgres.ts'
import { parseInput } from '../../lib/validation.ts'
import { recordAuditEntry } from '../audit/service.ts'
import { assertAdministrator, assertSellerExists } from './access.ts'
import { findBankAccount } from './bank-accounts.ts'
import { balanceOf, toEntryView } from './entries.ts'
import { adjustmentInput, payoutInput, type LedgerEntryView } from './types.ts'

/*
 * Payouts and adjustments (design doc 5.9). An administrator pays a seller
 * by bank transfer outside EcoKart, then records it here with the bank's
 * reference; a mistake anywhere in the ledger is fixed with an adjustment.
 * Both are appended to the ledger and audited.
 */

const PAY = 'record payouts'

export interface RecordedEntry {
  entry: LedgerEntryView
  /** The seller's balance after this entry. */
  balancePaise: number
}

/**
 * Records a bank transfer to the seller:
 * `{ amountPaise, reference }`. It must not be more than the seller's
 * balance, and goes to the bank account on file, whose row it locks first:
 * two payouts to one seller then run one after the other, so they cannot
 * both spend the same balance.
 */
export async function recordPayout(
  tx: Transaction,
  context: RequestContext,
  sellerId: string,
  input: unknown,
  ip?: string | null,
): Promise<RecordedEntry> {
  assertAdministrator(context, PAY)
  const payout = parseInput(
    payoutInput,
    input,
    'That payout cannot be recorded',
  )
  await assertSellerExists(tx, sellerId)
  const account = await findBankAccount(tx, sellerId, { lock: true })
  if (!account) {
    throw new ConflictError(
      'Enter the seller’s bank account before recording a payout',
    )
  }
  const duplicate = new ConflictError(
    `A payout with reference ${payout.reference} is already recorded for this seller`,
  )
  const [earlier] = await tx
    .select({ id: sellerLedgerEntries.id })
    .from(sellerLedgerEntries)
    .where(
      and(
        eq(sellerLedgerEntries.sellerId, sellerId),
        eq(sellerLedgerEntries.entryType, 'payout'),
        eq(sellerLedgerEntries.reference, payout.reference),
      ),
    )
  if (earlier) throw duplicate
  const balance = await balanceOf(tx, sellerId)
  if (payout.amountPaise > balance) {
    throw new ValidationError('That payout cannot be recorded', [
      `amountPaise must be at most the seller’s balance of ${formatRupees(Math.max(balance, 0))}`,
    ])
  }

  let row: typeof sellerLedgerEntries.$inferSelect | undefined
  try {
    ;[row] = await tx
      .insert(sellerLedgerEntries)
      .values({
        sellerId,
        entryType: 'payout',
        amountPaise: -payout.amountPaise,
        description: `Payout to account ending ${account.accountNumberLast4} (${account.ifsc})`,
        reference: payout.reference,
        createdBy: context.userId ?? null,
      })
      .returning()
  } catch (error) {
    // The lock makes this unreachable; the index is the backstop.
    if (
      uniqueViolation(error) === 'seller_ledger_entries_payout_reference_idx'
    ) {
      throw duplicate
    }
    throw error
  }
  const entry = toEntryView(row!)
  const balancePaise = balance - payout.amountPaise
  await recordAuditEntry(tx, {
    actorUserId: context.userId ?? null,
    actorRole: context.role,
    action: 'seller.payout.record',
    entityType: 'seller',
    entityId: sellerId,
    after: {
      entryId: entry.id,
      amountPaise: payout.amountPaise,
      reference: payout.reference,
      accountNumberLast4: account.accountNumberLast4,
      ifsc: account.ifsc,
      balancePaise,
    },
    ip,
  })
  return { entry, balancePaise }
}

/**
 * Corrects the seller's balance with a reason the seller sees:
 * `{ amountPaise, reason }`, positive to pay them more and negative to take
 * money back, for example a payout recorded with the wrong amount.
 */
export async function recordAdjustment(
  tx: Transaction,
  context: RequestContext,
  sellerId: string,
  input: unknown,
  ip?: string | null,
): Promise<RecordedEntry> {
  assertAdministrator(context, 'adjust seller balances')
  const adjustment = parseInput(
    adjustmentInput,
    input,
    'That adjustment cannot be recorded',
  )
  await assertSellerExists(tx, sellerId)
  const [row] = await tx
    .insert(sellerLedgerEntries)
    .values({
      sellerId,
      entryType: 'adjustment',
      amountPaise: adjustment.amountPaise,
      description: adjustment.reason,
      createdBy: context.userId ?? null,
    })
    .returning()
  const entry = toEntryView(row!)
  const balancePaise = await balanceOf(tx, sellerId)
  await recordAuditEntry(tx, {
    actorUserId: context.userId ?? null,
    actorRole: context.role,
    action: 'seller.ledger.adjust',
    entityType: 'seller',
    entityId: sellerId,
    after: {
      entryId: entry.id,
      amountPaise: adjustment.amountPaise,
      reason: adjustment.reason,
      balancePaise,
    },
    ip,
  })
  return { entry, balancePaise }
}
