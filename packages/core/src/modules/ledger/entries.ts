import { and, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm'
import type { Transaction } from '../../db/client.ts'
import type { RequestContext } from '../../db/context.ts'
import {
  sellerBankAccounts,
  sellerLedgerEntries,
} from '../../db/schema/index.ts'
import {
  afterKeyCursor,
  afterLogCursor,
  encodeKeyCursor,
  exactTime,
  logCursor,
  pageSize,
  toPage,
  type Page,
} from '../../lib/pagination.ts'
import { getSellerLabels } from '../sellers/service.ts'
import {
  assertAdministrator,
  assertSeller,
  assertSellerExists,
} from './access.ts'
import type {
  LedgerEntryType,
  LedgerEntryView,
  SellerBalance,
  SellerLedger,
} from './types.ts'

/*
 * Reading the seller ledger (design doc 5.9). A seller's balance is the sum
 * of their entries, worked out when asked, so it can never disagree with
 * the entries.
 */

type EntryRow = typeof sellerLedgerEntries.$inferSelect

const ENTRY_TYPES: readonly LedgerEntryType[] = [
  'sale',
  'commission',
  'refund_reversal',
  'commission_reversal',
  'payout',
  'adjustment',
]

export function toEntryView(row: EntryRow): LedgerEntryView {
  const entryType = ENTRY_TYPES.find((type) => type === row.entryType)
  if (!entryType) {
    throw new Error(
      `Ledger entry ${row.id} has an unknown type ${row.entryType}`,
    )
  }
  return {
    id: row.id,
    entryType,
    amountPaise: row.amountPaise,
    description: row.description,
    reference: row.reference,
    orderId: row.orderId,
    orderItemId: row.orderItemId,
    returnRequestId: row.returnRequestId,
    createdAt: row.createdAt,
  }
}

/** What EcoKart owes the seller now. */
export async function balanceOf(
  tx: Transaction,
  sellerId: string,
): Promise<number> {
  const [row] = await tx
    .select({
      // A sum of bigints is numeric, which arrives as text.
      balance: sql<string>`coalesce(sum(${sellerLedgerEntries.amountPaise}), 0)`,
    })
    .from(sellerLedgerEntries)
    .where(eq(sellerLedgerEntries.sellerId, sellerId))
  return Number(row?.balance ?? 0)
}

async function readLedger(
  tx: Transaction,
  sellerId: string,
  options: { cursor?: string | undefined; limit?: number | undefined },
): Promise<SellerLedger> {
  const limit = pageSize(options.limit)
  const rows = await tx
    .select({
      ...getTableColumns(sellerLedgerEntries),
      cursorTime: exactTime(sellerLedgerEntries.createdAt),
    })
    .from(sellerLedgerEntries)
    .where(
      and(
        eq(sellerLedgerEntries.sellerId, sellerId),
        options.cursor
          ? afterLogCursor(
              options.cursor,
              sellerLedgerEntries.createdAt,
              sellerLedgerEntries.id,
            )
          : undefined,
      ),
    )
    .orderBy(desc(sellerLedgerEntries.createdAt), desc(sellerLedgerEntries.id))
    .limit(limit + 1)
  return {
    sellerId,
    balancePaise: await balanceOf(tx, sellerId),
    ...toPage(rows, limit, toEntryView, logCursor),
  }
}

/** The seller's own ledger, newest first, with their balance. */
export async function getOwnLedger(
  tx: Transaction,
  context: RequestContext,
  options: { cursor?: string; limit?: number } = {},
): Promise<SellerLedger> {
  assertSeller(context)
  return readLedger(tx, context.sellerId, options)
}

/** A seller's ledger for administrators, newest first, with the balance. */
export async function getSellerLedger(
  tx: Transaction,
  context: RequestContext,
  sellerId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<SellerLedger> {
  assertAdministrator(context, 'see seller ledgers')
  await assertSellerExists(tx, sellerId)
  return readLedger(tx, sellerId, options)
}

const BALANCE_ORDER = 'balance'

/**
 * Every seller whose balance is not zero, largest first, for administrators
 * deciding whom to pay; sellers who owe EcoKart come last. The sums are
 * worked out from the ledger on each call through its (seller_id, ...)
 * index, which is quick at launch volumes.
 */
export async function listSellerBalances(
  tx: Transaction,
  context: RequestContext,
  options: { cursor?: string; limit?: number } = {},
): Promise<Page<SellerBalance>> {
  assertAdministrator(context, 'see seller balances')
  const limit = pageSize(options.limit)
  const balance = sql<string>`sum(${sellerLedgerEntries.amountPaise})`
  const rows = await tx
    .select({ sellerId: sellerLedgerEntries.sellerId, balance })
    .from(sellerLedgerEntries)
    .groupBy(sellerLedgerEntries.sellerId)
    .having(
      and(
        sql`${balance} <> 0`,
        options.cursor
          ? afterKeyCursor(
              options.cursor,
              BALANCE_ORDER,
              balance,
              sellerLedgerEntries.sellerId,
              'desc',
              'bigint',
            )
          : undefined,
      ),
    )
    .orderBy(desc(balance), desc(sellerLedgerEntries.sellerId))
    .limit(limit + 1)

  const ids = rows.map((row) => row.sellerId)
  const labels = await getSellerLabels(tx, ids)
  const accounts =
    ids.length === 0
      ? []
      : await tx
          .select({
            sellerId: sellerBankAccounts.sellerId,
            accountNumberLast4: sellerBankAccounts.accountNumberLast4,
            ifsc: sellerBankAccounts.ifsc,
          })
          .from(sellerBankAccounts)
          .where(inArray(sellerBankAccounts.sellerId, ids))
  const accountOf = new Map(
    accounts.map((account) => [account.sellerId, account]),
  )

  return toPage(
    rows,
    limit,
    (row): SellerBalance => {
      const label = labels.get(row.sellerId)
      if (!label) throw new Error(`Seller ${row.sellerId} is missing`)
      const account = accountOf.get(row.sellerId)
      return {
        sellerId: row.sellerId,
        displayName: label.displayName,
        status: label.status,
        balancePaise: Number(row.balance),
        bankAccount: account
          ? {
              accountNumberLast4: account.accountNumberLast4,
              ifsc: account.ifsc,
            }
          : null,
      }
    },
    (row) => encodeKeyCursor(BALANCE_ORDER, row.balance, row.sellerId),
  )
}
