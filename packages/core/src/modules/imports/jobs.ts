import { and, asc, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import type { z } from 'zod'
import type { Database, Transaction } from '../../db/client.ts'
import { withContext } from '../../db/context.ts'
import { catalogueImportRows, catalogueImports } from '../../db/schema/index.ts'
import {
  NotConfiguredError,
  TooManyRequestsError,
  ValidationError,
} from '../../errors.ts'
import { AiProviderError, AiReplyError } from '../../lib/ai/client.ts'
import type { AiModels } from '../../lib/ai/index.ts'
import { toCsv } from '../../lib/csv.ts'
import { jobQueueOf, type JobQueue } from '../../lib/queue.ts'
import {
  readSpreadsheet,
  SpreadsheetRejectedError,
  type Spreadsheet,
} from '../../lib/spreadsheets.ts'
import type { ObjectStorage } from '../../lib/storage.ts'
import { brandIdsByName } from '../catalogue/brands.ts'
import { loadCategoryTree } from '../catalogue/categories.ts'
import { createProduct, findUsedSkus } from '../catalogue/products.ts'
import { getAiRequest } from '../ai/queries.ts'
import {
  failQueuedAiCall,
  queueAiCall,
  runQueuedAiCall,
  type QueuedAiCall,
} from '../ai/service.ts'
import {
  mappingAnswer,
  mappingPrompt,
  mappingQuestion,
  matchByName,
  withAiAnswer,
  type MappingQuestion,
} from './mapping.ts'
import {
  describeProductIssues,
  normalizeRow,
  type ImportLookups,
} from './rows.ts'
import {
  READ_IMPORT_QUEUE,
  readImportJob,
  RUN_IMPORT_QUEUE,
  runImportJob,
  storedMapping,
  SUGGEST_MAPPING_QUEUE,
  suggestMappingJob,
} from './service.ts'
import {
  IMPORT_CONTENT_TYPES,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_COLUMNS,
  MAX_IMPORT_ROWS,
  type ColumnSuggestion,
  type ImportField,
  type ImportFileType,
} from './types.ts'

/*
 * The worker's import jobs (backend step 8). Only the worker loads this
 * file, because it loads the CSV and Excel parsers.
 */

export interface ImportJobDependencies {
  /** Connected as ecokart_worker. */
  db: Database
  storage: ObjectStorage
  /** Null when AI_ENABLED is false; the columns are then matched by name. */
  ai: AiModels | null
  /**
   * Adds the AI's look at the columns, in the read's transaction;
   * registerImportJobs makes it from the worker's own client.
   */
  queue: JobQueue
}

type ImportRow = typeof catalogueImports.$inferSelect

// Rows go to the database in groups, so a large file is a few statements.
const INSERT_BATCH = 500
const CHECK_BATCH = 200

const GIVE_UP_READING = 'The file could not be read; upload it again'
const GIVE_UP_IMPORTING =
  'The import stopped because of a problem on our side; the drafts made so far are kept'

async function removeUpload(
  storage: ObjectStorage,
  key: string,
): Promise<void> {
  try {
    await storage.remove(key)
  } catch (error) {
    // The bucket's lifecycle rule deletes leftover uploads after a day.
    console.warn(`Could not remove the upload ${key}`, error)
  }
}

/** Stops the whole import, for a reason the seller sees. */
async function failImport(
  db: Database,
  importId: string,
  reason: string,
): Promise<void> {
  await db
    .update(catalogueImports)
    .set({ status: 'failed', error: reason, completedAt: sql`now()` })
    .where(
      and(
        eq(catalogueImports.id, importId),
        inArray(catalogueImports.status, [
          'uploaded',
          'mapping_confirmed',
          'validating',
          'importing',
        ]),
      ),
    )
}

const fileTypeOf = (row: ImportRow): ImportFileType =>
  row.fileType === 'xlsx' ? 'xlsx' : 'csv'

/* The suggested column mapping (step 19, mapping.ts). */

const SYSTEM = { role: 'system' } as const

/** Rows looked at for sample values: enough to find a few in sparse columns. */
const SUGGESTION_ROWS = 20

/** The same columns and samples get the same suggestion for 30 days. */
const MAPPING_CACHE_SECONDS = 30 * 24 * 60 * 60

/** The AI call that looks at an import's open columns, for its seller. */
function mappingCall(sellerId: string, question: MappingQuestion) {
  const { prompt, input } = mappingPrompt(question)
  return {
    prompt,
    call: {
      feature: 'import_mapping' as const,
      uses: 'text' as const,
      sellerId,
      input,
      cacheSeconds: MAPPING_CACHE_SECONDS,
      schema: mappingAnswer,
    },
  }
}

/** Ends the suggestion: the import waits for the seller to confirm. */
async function finishSuggestion(
  db: Database | Transaction,
  importId: string,
  suggested: Record<string, ColumnSuggestion>,
  aiRequestId: string | null,
): Promise<void> {
  await db
    .update(catalogueImports)
    .set({
      suggestedMapping: suggested,
      aiRequestId,
      status: 'mapping_suggested',
    })
    .where(
      and(
        eq(catalogueImports.id, importId),
        // The seller may have chosen the columns already.
        eq(catalogueImports.status, 'uploaded'),
      ),
    )
}

/**
 * Suggests a field for each column, in the read's transaction: by name at
 * once, and for the columns the names leave open, by queueing the AI's look
 * at them, which counts against the seller's daily AI calls from now on.
 * With AI switched off, a daily limit used up, or nothing left to ask, the
 * names' suggestion is complete as it is.
 */
async function suggestMapping(
  tx: Transaction,
  deps: ImportJobDependencies,
  row: ImportRow,
  headers: string[],
  rows: Record<string, string>[],
): Promise<void> {
  const byName = matchByName(headers)
  const question = mappingQuestion(headers, rows, byName)
  if (!question || deps.ai === null) {
    await finishSuggestion(tx, row.id, byName, null)
    return
  }
  let queued: QueuedAiCall<MappingAnswer>
  try {
    queued = await queueAiCall(
      tx,
      SYSTEM,
      deps.ai,
      mappingCall(row.sellerId, question).call,
    )
  } catch (error) {
    if (
      error instanceof TooManyRequestsError ||
      error instanceof NotConfiguredError
    ) {
      await finishSuggestion(tx, row.id, byName, null)
      return
    }
    throw error
  }
  if (queued.kind === 'cached') {
    await finishSuggestion(
      tx,
      row.id,
      withAiAnswer(question, queued.value, byName),
      queued.requestId,
    )
    return
  }
  await tx
    .update(catalogueImports)
    .set({ suggestedMapping: byName, aiRequestId: queued.requestId })
    .where(eq(catalogueImports.id, row.id))
  await deps.queue.send(tx, SUGGEST_MAPPING_QUEUE, {
    importId: row.id,
    requestId: queued.requestId,
  })
}

type MappingAnswer = z.output<typeof mappingAnswer>

/**
 * Asks the AI about an import's open columns (the worker's job) and adds
 * its answer to the names' suggestion. When the answer cannot be had,
 * because AI was switched off, the reply was unusable twice, or the
 * provider kept failing, the names' suggestion stands, so the seller is
 * never kept waiting. A provider failure before the job's `lastAttempt` is
 * thrown, so the queue tries again. An import the seller has already
 * mapped is left alone.
 */
export async function suggestImportMapping(
  deps: ImportJobDependencies,
  job: z.output<typeof suggestMappingJob>,
  { lastAttempt = true }: { lastAttempt?: boolean } = {},
): Promise<void> {
  const [row] = await deps.db
    .select()
    .from(catalogueImports)
    .where(eq(catalogueImports.id, job.importId))
  if (
    !row?.headers ||
    row.status !== 'uploaded' ||
    row.aiRequestId !== job.requestId
  ) {
    await failQueuedAiCall(
      deps.db,
      SYSTEM,
      job.requestId,
      'The columns were chosen before the AI looked at them',
    )
    return
  }
  const sample = await deps.db
    .select({ raw: catalogueImportRows.raw })
    .from(catalogueImportRows)
    .where(eq(catalogueImportRows.importId, row.id))
    .orderBy(asc(catalogueImportRows.rowNumber))
    .limit(SUGGESTION_ROWS)
  const byName = matchByName(row.headers)
  const question = mappingQuestion(
    row.headers,
    sample.map((line) => line.raw),
    byName,
  )
  if (!question || deps.ai === null) {
    await failQueuedAiCall(
      deps.db,
      SYSTEM,
      job.requestId,
      question ? 'AI features are switched off' : 'Nothing was left to ask',
    )
    await finishSuggestion(deps.db, row.id, byName, job.requestId)
    return
  }
  const { prompt, call } = mappingCall(row.sellerId, question)
  let answer: MappingAnswer | null = null
  try {
    const made = await runQueuedAiCall(
      deps.db,
      SYSTEM,
      deps.ai,
      job.requestId,
      { ...call, run: (text) => text.json(prompt, mappingAnswer) },
      { lastAttempt },
    )
    answer = made
      ? made.value
      : // Answered by an earlier run of this job that stopped before
        // saving the suggestion.
        await answerOf(deps.db, job.requestId)
  } catch (error) {
    // Each of these is already recorded on the AI call as failed.
    if (!(
      error instanceof AiReplyError ||
      error instanceof NotConfiguredError ||
      (error instanceof AiProviderError && lastAttempt)
    )) {
      throw error
    }
  }
  await finishSuggestion(
    deps.db,
    row.id,
    answer ? withAiAnswer(question, answer, byName) : byName,
    job.requestId,
  )
}

/** The answer of an import_mapping call that succeeded, or null. */
async function answerOf(
  db: Database,
  requestId: string,
): Promise<MappingAnswer | null> {
  const request = await db.transaction((tx) =>
    getAiRequest(tx, 'import_mapping', requestId),
  )
  if (request?.status !== 'succeeded') return null
  const parsed = mappingAnswer.safeParse(request.result)
  return parsed.success ? parsed.data : null
}

/**
 * Reads the uploaded file: its column headings, and one stored row for each
 * spreadsheet row. Keeps the file privately and removes the upload. A file
 * that cannot be imported fails the import with a reason the seller sees.
 */
export async function readImportFile(
  deps: ImportJobDependencies,
  importId: string,
  uploadKey: string,
  { lastAttempt = true }: { lastAttempt?: boolean } = {},
): Promise<void> {
  const [row] = await deps.db
    .select()
    .from(catalogueImports)
    .where(eq(catalogueImports.id, importId))
  if (!row || row.status !== 'uploaded' || row.headers !== null) return

  let sheet: Spreadsheet
  try {
    const bytes = await deps.storage.read(uploadKey)
    if (!bytes) {
      await failImport(
        deps.db,
        row.id,
        'The upload did not arrive; upload the file again',
      )
      return
    }
    if (bytes.length > MAX_IMPORT_BYTES) {
      await failImport(deps.db, row.id, 'The file is larger than 10 MB')
      await removeUpload(deps.storage, uploadKey)
      return
    }
    sheet = await readSpreadsheet(bytes, fileTypeOf(row), {
      maxRows: MAX_IMPORT_ROWS,
      maxColumns: MAX_IMPORT_COLUMNS,
    })
    await deps.storage.write(row.fileStorageKey, bytes, {
      contentType: IMPORT_CONTENT_TYPES[fileTypeOf(row)],
    })
  } catch (error) {
    if (error instanceof SpreadsheetRejectedError) {
      await failImport(deps.db, row.id, error.message)
      await removeUpload(deps.storage, uploadKey)
      return
    }
    if (lastAttempt) {
      console.error(`Giving up on reading import ${row.id}`, error)
      await failImport(deps.db, row.id, GIVE_UP_READING)
      return
    }
    throw error
  }

  await deps.db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: catalogueImports.status })
      .from(catalogueImports)
      .where(
        and(
          eq(catalogueImports.id, row.id),
          eq(catalogueImports.status, 'uploaded'),
          isNull(catalogueImports.headers),
        ),
      )
      .for('update')
    if (!current) return
    for (let start = 0; start < sheet.rows.length; start += INSERT_BATCH) {
      await tx.insert(catalogueImportRows).values(
        sheet.rows.slice(start, start + INSERT_BATCH).map((line) => ({
          importId: row.id,
          rowNumber: line.rowNumber,
          raw: Object.fromEntries(
            sheet.headers.map((header, column) => [
              header,
              line.values[column] ?? '',
            ]),
          ),
        })),
      )
    }
    await tx
      .update(catalogueImports)
      .set({ headers: sheet.headers, totalRows: sheet.rows.length })
      .where(eq(catalogueImports.id, row.id))
    await suggestMapping(
      tx,
      deps,
      row,
      sheet.headers,
      sheet.rows
        .slice(0, SUGGESTION_ROWS)
        .map((line) =>
          Object.fromEntries(
            sheet.headers.map((header, column) => [
              header,
              line.values[column] ?? '',
            ]),
          ),
        ),
    )
  })
  await removeUpload(deps.storage, uploadKey)
}

async function loadLookups(db: Database): Promise<ImportLookups> {
  return db.transaction(async (tx) => {
    const tree = await loadCategoryTree(tx)
    return {
      categories: tree.categories.map((category) => ({
        id: category.id,
        path: tree.pathTo(category.id).map((step) => step.name),
      })),
      brandIds: await brandIdsByName(tx),
    }
  })
}

/**
 * Checks every row not checked yet, in file order, and stores either the
 * product it describes or why it cannot be imported. Runs again safely
 * after a crash: rows already checked keep their result.
 */
async function checkRows(
  db: Database,
  row: ImportRow,
  mapping: Record<string, ImportField>,
): Promise<void> {
  const lookups = await loadLookups(db)
  const skuColumn = `"${Object.entries(mapping).find(([, field]) => field === 'sku')?.[0]}"`
  // SKUs of rows checked before a restart, by lower case, to their row.
  const seen = new Map<string, number>()
  const checked = await db
    .select({
      rowNumber: catalogueImportRows.rowNumber,
      sku: sql<string>`lower(${catalogueImportRows.normalized} -> 'variants' -> 0 ->> 'sku')`,
    })
    .from(catalogueImportRows)
    .where(
      and(
        eq(catalogueImportRows.importId, row.id),
        isNotNull(catalogueImportRows.normalized),
      ),
    )
  for (const line of checked) seen.set(line.sku, line.rowNumber)

  let after = 0
  for (;;) {
    const batch = await db
      .select()
      .from(catalogueImportRows)
      .where(
        and(
          eq(catalogueImportRows.importId, row.id),
          eq(catalogueImportRows.status, 'pending'),
          isNull(catalogueImportRows.normalized),
          gt(catalogueImportRows.rowNumber, after),
        ),
      )
      .orderBy(asc(catalogueImportRows.rowNumber))
      .limit(CHECK_BATCH)
    if (batch.length === 0) return
    after = batch.at(-1)!.rowNumber

    const results = batch.map((line) => ({
      line,
      result: normalizeRow(line.raw, mapping, lookups),
    }))
    await db.transaction(async (tx) => {
      const used = await findUsedSkus(
        tx,
        row.sellerId,
        results.flatMap(({ result }) => (result.ok ? [result.sku] : [])),
      )
      for (const { line, result } of results) {
        let issues = result.ok ? [] : result.issues
        if (result.ok) {
          const sku = result.sku.toLowerCase()
          const earlier = seen.get(sku)
          if (earlier !== undefined) {
            issues = [
              `${skuColumn} "${result.sku}" is already on row ${earlier} of this file`,
            ]
          } else if (used.has(sku)) {
            issues = [
              `${skuColumn} "${result.sku}" is already used by another of your products`,
            ]
          } else {
            seen.set(sku, line.rowNumber)
          }
        }
        await tx
          .update(catalogueImportRows)
          .set(
            issues.length > 0
              ? { status: 'error', errorMessage: issues.join('; ') }
              : { normalized: result.ok ? result.product : null },
          )
          .where(eq(catalogueImportRows.id, line.id))
      }
    })
  }
}

/** Thrown to undo a draft when another run already handled its row. */
class RowAlreadyDone extends Error {}

/**
 * Makes a draft for every checked row, each in its own transaction with the
 * row's result, so a crash never makes the same draft twice.
 */
async function createDrafts(
  deps: ImportJobDependencies,
  row: ImportRow,
  mapping: Record<string, ImportField>,
): Promise<void> {
  const context = {
    role: 'seller' as const,
    userId: row.uploadedBy,
    sellerId: row.sellerId,
  }
  let after = 0
  for (;;) {
    const batch = await deps.db
      .select()
      .from(catalogueImportRows)
      .where(
        and(
          eq(catalogueImportRows.importId, row.id),
          eq(catalogueImportRows.status, 'pending'),
          isNotNull(catalogueImportRows.normalized),
          gt(catalogueImportRows.rowNumber, after),
        ),
      )
      .orderBy(asc(catalogueImportRows.rowNumber))
      .limit(CHECK_BATCH)
    if (batch.length === 0) return
    after = batch.at(-1)!.rowNumber

    for (const line of batch) {
      try {
        await withContext(deps.db, context, async (tx) => {
          const done = (
            productId: string | null,
            errorMessage: string | null,
          ) =>
            tx
              .update(catalogueImportRows)
              .set(
                productId
                  ? { status: 'ok', productId }
                  : { status: 'error', errorMessage },
              )
              .where(
                and(
                  eq(catalogueImportRows.id, line.id),
                  eq(catalogueImportRows.status, 'pending'),
                ),
              )
              .returning({ id: catalogueImportRows.id })
          let updated: { id: number }[]
          try {
            // A savepoint, so a refused product leaves the transaction usable.
            const product = await tx.transaction((inner) =>
              createProduct(inner, deps.storage, context, line.normalized),
            )
            updated = await done(product.id, null)
          } catch (error) {
            if (!(error instanceof ValidationError)) throw error
            updated = await done(
              null,
              describeProductIssues(error.issues, mapping).join('; '),
            )
          }
          if (updated.length === 0) throw new RowAlreadyDone()
        })
      } catch (error) {
        if (!(error instanceof RowAlreadyDone)) throw error
      }
    }
  }
}

/** Counts the rows, writes the report of rows not imported, and finishes. */
async function finishImport(
  deps: ImportJobDependencies,
  row: ImportRow,
): Promise<void> {
  const counts = await deps.db
    .select({
      status: catalogueImportRows.status,
      count: sql<number>`count(*)::int`,
    })
    .from(catalogueImportRows)
    .where(eq(catalogueImportRows.importId, row.id))
    .groupBy(catalogueImportRows.status)
  const countOf = (status: string) =>
    counts.find((line) => line.status === status)?.count ?? 0

  let errorReportKey: string | null = null
  if (countOf('error') > 0) {
    const failed = await deps.db
      .select({
        rowNumber: catalogueImportRows.rowNumber,
        errorMessage: catalogueImportRows.errorMessage,
        raw: catalogueImportRows.raw,
      })
      .from(catalogueImportRows)
      .where(
        and(
          eq(catalogueImportRows.importId, row.id),
          eq(catalogueImportRows.status, 'error'),
        ),
      )
      .orderBy(asc(catalogueImportRows.rowNumber))
    const headers = row.headers ?? []
    errorReportKey = `imports/${row.id}/rows-not-imported.csv`
    await deps.storage.write(
      errorReportKey,
      toCsv([
        ['Row', 'Problem', ...headers],
        ...failed.map((line) => [
          String(line.rowNumber),
          line.errorMessage ?? '',
          ...headers.map((header) => line.raw[header] ?? ''),
        ]),
      ]),
      { contentType: 'text/csv; charset=utf-8' },
    )
  }
  await deps.db
    .update(catalogueImports)
    .set({
      status: 'completed',
      okRows: countOf('ok'),
      errorRows: countOf('error'),
      errorReportKey,
      completedAt: sql`now()`,
    })
    .where(
      and(
        eq(catalogueImports.id, row.id),
        eq(catalogueImports.status, 'importing'),
      ),
    )
}

async function moveTo(
  db: Database,
  importId: string,
  from: ImportRow['status'][],
  to: 'validating' | 'importing',
): Promise<void> {
  await db
    .update(catalogueImports)
    .set({ status: to })
    .where(
      and(
        eq(catalogueImports.id, importId),
        inArray(catalogueImports.status, from),
      ),
    )
}

/**
 * Runs an import whose columns are chosen: checks every row, makes a draft
 * for each good one, and reports the rest. Picks up where it stopped when
 * pg-boss runs it again after a crash.
 */
export async function runImport(
  deps: ImportJobDependencies,
  importId: string,
  { lastAttempt = true }: { lastAttempt?: boolean } = {},
): Promise<void> {
  const [row] = await deps.db
    .select()
    .from(catalogueImports)
    .where(eq(catalogueImports.id, importId))
  const mapping = row ? storedMapping(row) : null
  if (
    !row ||
    !mapping ||
    !['mapping_confirmed', 'validating', 'importing'].includes(row.status)
  ) {
    return
  }
  try {
    if (row.status !== 'importing') {
      await moveTo(deps.db, row.id, ['mapping_confirmed'], 'validating')
      await checkRows(deps.db, row, mapping)
      await moveTo(deps.db, row.id, ['validating'], 'importing')
    }
    await createDrafts(deps, row, mapping)
    await finishImport(deps, row)
  } catch (error) {
    if (lastAttempt) {
      console.error(`Giving up on import ${row.id}`, error)
      await failImport(deps.db, row.id, GIVE_UP_IMPORTING)
      return
    }
    throw error
  }
}

export async function registerImportJobs(
  boss: PgBoss,
  workerDeps: Omit<ImportJobDependencies, 'queue'>,
): Promise<void> {
  // Reading a file queues the AI's look at its columns with this client.
  const deps = { ...workerDeps, queue: jobQueueOf(boss) }
  await boss.work(
    READ_IMPORT_QUEUE,
    { includeMetadata: true },
    async ([job]) => {
      if (!job) return
      const { importId, uploadKey } = readImportJob.parse(job.data)
      await readImportFile(deps, importId, uploadKey, {
        lastAttempt: job.retryCount >= job.retryLimit,
      })
    },
  )
  await boss.work(
    SUGGEST_MAPPING_QUEUE,
    { includeMetadata: true },
    async ([job]) => {
      if (!job) return
      await suggestImportMapping(deps, suggestMappingJob.parse(job.data), {
        lastAttempt: job.retryCount >= job.retryLimit,
      })
    },
  )
  await boss.work(
    RUN_IMPORT_QUEUE,
    { includeMetadata: true },
    async ([job]) => {
      if (!job) return
      const { importId } = runImportJob.parse(job.data)
      await runImport(deps, importId, {
        lastAttempt: job.retryCount >= job.retryLimit,
      })
    },
  )
}
