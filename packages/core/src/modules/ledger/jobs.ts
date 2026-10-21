import { and, asc, eq, gte, lt, sql } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import type { Database, Transaction } from '../../db/client.ts'
import {
  sellerLedgerEntries,
  settlementStatements,
} from '../../db/schema/index.ts'
import { toCsv } from '../../lib/csv.ts'
import { plainRupees } from '../../lib/money.ts'
import type { ObjectStorage } from '../../lib/storage.ts'
import { DAY_MS, indianDateStart } from '../ai/days.ts'
import { getOrderNumbers } from '../orders/queries.ts'
import {
  MAKE_STATEMENT_QUEUE,
  makeStatementJob,
  statementStorageKey,
} from './statements.ts'
import type { LedgerEntryType } from './types.ts'

/*
 * The worker's ledger jobs (design doc 5.9): making settlement statements.
 */

export interface LedgerJobDependencies {
  /** Connected as ecokart_worker. */
  db: Database
  storage: ObjectStorage
}

const GIVE_UP = 'The statement could not be made; ask for it again'

const TYPE_LABELS = new Map<string, string>(
  Object.entries({
    sale: 'Sale',
    commission: 'Commission',
    refund_reversal: 'Refund',
    commission_reversal: 'Commission returned',
    payout: 'Payout',
    adjustment: 'Adjustment',
  } satisfies Record<LedgerEntryType, string>),
)

const indiaTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

/** 2026-10-19 14:32:05, India time, which spreadsheets read as a date. */
function formatIndiaTime(time: Date): string {
  const part = Object.fromEntries(
    indiaTime.formatToParts(time).map(({ type, value }) => [type, value]),
  )
  return `${part.year}-${part.month}-${part.day} ${part.hour}:${part.minute}:${part.second}`
}

type StatementRow = typeof settlementStatements.$inferSelect

interface StatementFile {
  csv: Buffer
  openingBalancePaise: number
  closingBalancePaise: number
  entryCount: number
}

/**
 * The statement as of now: the balance before the period, then every entry
 * in it, oldest first, with the balance after each. Read in one snapshot
 * (the caller's repeatable-read transaction), so the balances always add up
 * even while new sales arrive.
 */
async function buildStatement(
  tx: Transaction,
  statement: StatementRow,
): Promise<StatementFile> {
  const start = indianDateStart(statement.periodStart)
  const end = new Date(indianDateStart(statement.periodEnd).getTime() + DAY_MS)
  const [opening] = await tx
    .select({
      balance: sql<string>`coalesce(sum(${sellerLedgerEntries.amountPaise}), 0)`,
      // The snapshot's own time: entries after it are not in the file.
      madeAt: sql<string>`to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
    })
    .from(sellerLedgerEntries)
    .where(
      and(
        eq(sellerLedgerEntries.sellerId, statement.sellerId),
        lt(sellerLedgerEntries.createdAt, start),
      ),
    )
  const entries = await tx
    .select()
    .from(sellerLedgerEntries)
    .where(
      and(
        eq(sellerLedgerEntries.sellerId, statement.sellerId),
        gte(sellerLedgerEntries.createdAt, start),
        lt(sellerLedgerEntries.createdAt, end),
      ),
    )
    .orderBy(asc(sellerLedgerEntries.createdAt), asc(sellerLedgerEntries.id))
  const orderNumbers = await getOrderNumbers(
    tx,
    entries.flatMap((entry) => (entry.orderId ? [entry.orderId] : [])),
  )

  const openingBalancePaise = Number(opening?.balance ?? 0)
  const madeAt = opening ? new Date(opening.madeAt) : new Date()
  let balance = openingBalancePaise
  const lines = entries.map((entry) => {
    balance += entry.amountPaise
    return [
      formatIndiaTime(entry.createdAt),
      TYPE_LABELS.get(entry.entryType) ?? entry.entryType,
      entry.description,
      (entry.orderId ? orderNumbers.get(entry.orderId) : undefined) ?? '',
      entry.reference ?? '',
      plainRupees(entry.amountPaise),
      plainRupees(balance),
    ]
  })
  const csv = toCsv([
    [
      'Date and time (IST)',
      'Type',
      'Description',
      'Order',
      'Reference',
      'Amount (₹)',
      'Balance (₹)',
    ],
    [
      `${statement.periodStart} 00:00:00`,
      'Opening balance',
      '',
      '',
      '',
      '',
      plainRupees(openingBalancePaise),
    ],
    ...lines,
    [
      // A period that has not ended yet closes when the statement was made.
      madeAt < end
        ? formatIndiaTime(madeAt)
        : `${statement.periodEnd} 23:59:59`,
      'Closing balance',
      '',
      '',
      '',
      '',
      plainRupees(balance),
    ],
  ])
  return {
    csv,
    openingBalancePaise,
    closingBalancePaise: balance,
    entryCount: entries.length,
  }
}

/**
 * Makes the statement's CSV, stores it privately, and marks the statement
 * ready. Running it again does nothing more. Errors are thrown so pg-boss
 * retries; on the `lastAttempt` the statement is marked failed instead.
 */
export async function makeSettlementStatement(
  deps: LedgerJobDependencies,
  statementId: string,
  { lastAttempt = true }: { lastAttempt?: boolean } = {},
): Promise<void> {
  const [statement] = await deps.db
    .select()
    .from(settlementStatements)
    .where(eq(settlementStatements.id, statementId))
  if (!statement || statement.status !== 'processing') return
  const stillProcessing = and(
    eq(settlementStatements.id, statementId),
    eq(settlementStatements.status, 'processing'),
  )
  try {
    const file = await deps.db.transaction(
      (tx) => buildStatement(tx, statement),
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
    const key = statementStorageKey(statement.sellerId, statement.id)
    await deps.storage.write(key, file.csv, {
      contentType: 'text/csv; charset=utf-8',
      // A seller's earnings: no shared cache may keep a copy.
      cacheControl: 'private, no-store',
    })
    await deps.db
      .update(settlementStatements)
      .set({
        status: 'ready',
        storageKey: key,
        openingBalancePaise: file.openingBalancePaise,
        closingBalancePaise: file.closingBalancePaise,
        entryCount: file.entryCount,
      })
      .where(stillProcessing)
  } catch (error) {
    if (!lastAttempt) throw error
    console.error(`Giving up on settlement statement ${statementId}`, error)
    await deps.db
      .update(settlementStatements)
      .set({ status: 'failed', failureReason: GIVE_UP })
      .where(stillProcessing)
  }
}

/** Called by the worker at startup (apps/worker/src/worker.ts). */
export async function registerLedgerJobs(
  boss: PgBoss,
  deps: LedgerJobDependencies,
): Promise<void> {
  await boss.work(
    MAKE_STATEMENT_QUEUE,
    { includeMetadata: true },
    async ([job]) => {
      if (!job) return
      const { statementId } = makeStatementJob.parse(job.data)
      await makeSettlementStatement(deps, statementId, {
        lastAttempt: job.retryCount >= job.retryLimit,
      })
    },
  )
}
