import { randomUUID } from 'node:crypto'
import { and, desc, eq, gt, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Database, Transaction } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { settlementStatements } from '../../db/schema/index.ts'
import {
  ConflictError,
  NotFoundError,
  NotSignedInError,
  TooManyRequestsError,
  ValidationError,
} from '../../errors.ts'
import {
  afterCursor,
  exactTime,
  newestFirstCursor,
  pageSize,
  toPage,
  type Page,
} from '../../lib/pagination.ts'
import type { JobQueue, QueueDefinition } from '../../lib/queue.ts'
import type { ObjectStorage } from '../../lib/storage.ts'
import { isUuid, parseInput } from '../../lib/validation.ts'
import { DAY_MS, indianDate, indianDateStart } from '../ai/days.ts'
import { recordAuditEntry } from '../audit/service.ts'
import {
  assertAdministrator,
  assertSeller,
  assertSellerExists,
  type Administrator,
  type Seller,
} from './access.ts'
import {
  MAX_STATEMENT_DAYS,
  MAX_STATEMENTS_PER_DAY,
  statementRequest,
  type SettlementStatementDownload,
  type SettlementStatementStatus,
  type SettlementStatementView,
} from './types.ts'

/*
 * Settlement statements (design doc 5.9): the CSV of a seller's ledger
 * entries between two India dates, with the opening and closing balance.
 * The seller or an administrator asks for one, the worker makes the file
 * (jobs.ts) and keeps it private, and both open it through a short-lived
 * signed link.
 */

export const MAKE_STATEMENT_QUEUE = 'ledger.make-statement'

export const ledgerQueues: QueueDefinition[] = [
  {
    name: MAKE_STATEMENT_QUEUE,
    options: {
      // 30 seconds doubling five times: about fifteen minutes in all.
      retryLimit: 5,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 300,
      deleteAfterSeconds: 7 * 24 * 60 * 60,
    },
  },
]

export const makeStatementJob = z.object({ statementId: z.uuid() })

/** Where the worker keeps the file; the bucket keeps it private. */
export const statementStorageKey = (sellerId: string, statementId: string) =>
  `settlements/${sellerId}/${statementId}.csv`

const DOWNLOAD_SECONDS = 5 * 60
const NOT_FOUND = 'There is no settlement statement with that id'
const INVALID = 'That statement cannot be made'

type StatementRow = typeof settlementStatements.$inferSelect

const STATUSES: readonly SettlementStatementStatus[] = [
  'processing',
  'ready',
  'failed',
]

function toView(row: StatementRow): SettlementStatementView {
  const status = STATUSES.find((value) => value === row.status)
  if (!status) {
    throw new Error(`Settlement statement ${row.id} has an unknown status`)
  }
  return {
    id: row.id,
    sellerId: row.sellerId,
    from: row.periodStart,
    to: row.periodEnd,
    status,
    openingBalancePaise: row.openingBalancePaise,
    closingBalancePaise: row.closingBalancePaise,
    entryCount: row.entryCount,
    failureReason: row.failureReason,
    requestedAt: row.createdAt,
    madeAt: status === 'ready' ? row.updatedAt : null,
  }
}

/** The period asked for, checked against today in India. */
function parsePeriod(input: unknown, now: Date): { from: string; to: string } {
  const { from, to } = parseInput(statementRequest, input, INVALID)
  const days =
    (indianDateStart(to).getTime() - indianDateStart(from).getTime()) / DAY_MS +
    1
  const issues = [
    ...(days < 1 ? ['from must not be after to'] : []),
    ...(days > MAX_STATEMENT_DAYS
      ? [`a statement can cover at most ${MAX_STATEMENT_DAYS} days`]
      : []),
    ...(to > indianDate(now) ? ['to must not be after today'] : []),
  ]
  if (issues.length > 0) throw new ValidationError(INVALID, issues)
  return { from, to }
}

async function addStatement(
  tx: Transaction,
  queue: JobQueue,
  context: Seller | Administrator,
  sellerId: string,
  period: { from: string; to: string },
): Promise<SettlementStatementView> {
  const [{ count } = { count: 0 }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(settlementStatements)
    .where(
      and(
        eq(settlementStatements.sellerId, sellerId),
        gt(settlementStatements.createdAt, sql`now() - interval '1 day'`),
      ),
    )
  if (count >= MAX_STATEMENTS_PER_DAY) {
    throw new TooManyRequestsError(
      `At most ${MAX_STATEMENTS_PER_DAY} statements can be asked for in a day; open one already made, or try again tomorrow`,
    )
  }
  const id = randomUUID()
  const [row] = await tx
    .insert(settlementStatements)
    .values({
      id,
      sellerId,
      requestedBy: context.userId ?? null,
      periodStart: period.from,
      periodEnd: period.to,
    })
    .returning()
  await queue.send(tx, MAKE_STATEMENT_QUEUE, { statementId: id })
  return toView(row!)
}

/**
 * The seller asks for their own statement: `{ from, to }`, India dates such
 * as `2026-10-01`, both included, at most a year, ending today at the latest.
 * The worker makes the file; follow it with `getSettlementStatement`.
 */
export async function requestOwnStatement(
  tx: Transaction,
  queue: JobQueue,
  context: RequestContext,
  input: unknown,
  now: Date = new Date(),
): Promise<SettlementStatementView> {
  assertSeller(context)
  return addStatement(
    tx,
    queue,
    context,
    context.sellerId,
    parsePeriod(input, now),
  )
}

/** An administrator asks for a seller's statement, as `requestOwnStatement`; audited. */
export async function requestSellerStatement(
  tx: Transaction,
  queue: JobQueue,
  context: RequestContext,
  sellerId: string,
  input: unknown,
  ip?: string | null,
  now: Date = new Date(),
): Promise<SettlementStatementView> {
  assertAdministrator(context, 'ask for seller statements')
  const period = parsePeriod(input, now)
  await assertSellerExists(tx, sellerId)
  const statement = await addStatement(tx, queue, context, sellerId, period)
  await recordAuditEntry(tx, {
    actorUserId: context.userId ?? null,
    actorRole: context.role,
    action: 'seller.statement.request',
    entityType: 'seller',
    entityId: sellerId,
    after: { statementId: statement.id, from: period.from, to: period.to },
    ip,
  })
  return statement
}

async function listStatements(
  tx: Transaction,
  sellerId: string,
  options: { cursor?: string | undefined; limit?: number | undefined },
): Promise<Page<SettlementStatementView>> {
  const limit = pageSize(options.limit)
  const rows = await tx
    .select({
      row: settlementStatements,
      id: settlementStatements.id,
      cursorTime: exactTime(settlementStatements.createdAt),
    })
    .from(settlementStatements)
    .where(
      and(
        eq(settlementStatements.sellerId, sellerId),
        options.cursor
          ? afterCursor(
              options.cursor,
              settlementStatements.createdAt,
              settlementStatements.id,
            )
          : undefined,
      ),
    )
    .orderBy(
      desc(settlementStatements.createdAt),
      desc(settlementStatements.id),
    )
    .limit(limit + 1)
  return toPage(rows, limit, ({ row }) => toView(row), newestFirstCursor)
}

/** The seller's own statements, newest first. */
export async function listOwnStatements(
  tx: Transaction,
  context: RequestContext,
  options: { cursor?: string; limit?: number } = {},
): Promise<Page<SettlementStatementView>> {
  assertSeller(context)
  return listStatements(tx, context.sellerId, options)
}

/** A seller's statements for administrators, newest first. */
export async function listSellerStatements(
  tx: Transaction,
  context: RequestContext,
  sellerId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<Page<SettlementStatementView>> {
  assertAdministrator(context, 'see seller statements')
  await assertSellerExists(tx, sellerId)
  return listStatements(tx, sellerId, options)
}

/** The statement's row, for its seller and administrators only. */
async function findVisibleStatement(
  tx: Transaction,
  context: RequestContext,
  statementId: string,
): Promise<StatementRow> {
  if (context.role === 'anonymous') throw new NotSignedInError()
  if (!isUuid(statementId)) throw new NotFoundError(NOT_FOUND)
  const [row] = await tx
    .select()
    .from(settlementStatements)
    .where(eq(settlementStatements.id, statementId))
  const allowed =
    row &&
    (context.role === 'admin' ||
      context.role === 'system' ||
      (context.role === 'seller' && row.sellerId === context.sellerId))
  if (!allowed) throw new NotFoundError(NOT_FOUND)
  return row
}

/** One statement, for following the worker: its seller and administrators. */
export async function getSettlementStatement(
  tx: Transaction,
  context: RequestContext,
  statementId: string,
): Promise<SettlementStatementView> {
  return toView(await findVisibleStatement(tx, context, statementId))
}

/**
 * A five-minute link to the statement's CSV, for its seller and
 * administrators. The link is signed outside the transaction.
 */
export async function getSettlementStatementDownload(
  { db, storage }: { db: Database; storage: ObjectStorage },
  context: RequestContext,
  statementId: string,
): Promise<SettlementStatementDownload> {
  const row = await withContext(db, context, (tx) =>
    findVisibleStatement(tx, context, statementId),
  )
  if (!row.storageKey) {
    throw new ConflictError(
      row.status === 'failed'
        ? 'This statement could not be made; ask for a new one'
        : 'The statement is still being made; try again in a moment',
    )
  }
  const fileName = `settlement-${row.periodStart}-to-${row.periodEnd}.csv`
  // Counted before signing, so the link never outlives what this says.
  const expiresAt = new Date(Date.now() + DOWNLOAD_SECONDS * 1000)
  const url = await storage.createDownloadUrl(row.storageKey, {
    expiresInSeconds: DOWNLOAD_SECONDS,
    fileName,
  })
  return { url, expiresAt, fileName }
}
