import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import type { Database, Transaction } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { catalogueImportRows, catalogueImports } from '../../db/schema/index.ts'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
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
import {
  IMPORT_CONTENT_TYPES,
  IMPORT_FIELD_INFO,
  IMPORT_FILE_TYPES,
  IMPORT_STATUSES,
  importMapping,
  importUploadRequest,
  MAX_IMPORT_BYTES,
  newImport,
  type ImportErrorReport,
  type ImportField,
  type ImportFileType,
  type ImportListOptions,
  type ImportStatus,
  type ImportSummary,
  type ImportUpload,
  type ImportView,
} from './types.ts'

/*
 * A seller's catalogue import from a CSV or Excel file (backend step 8,
 * design doc 6.7):
 *
 * 1. The browser uploads the file straight to object storage with a signed
 *    form, and the seller adds it here as `uploaded`.
 * 2. The worker reads it: the column headings, and one stored row for each
 *    spreadsheet row (jobs.ts).
 * 3. The seller says which column fills which field; the import moves to
 *    `mapping_confirmed`. (Step 19 adds an AI suggestion, `mapping_suggested`.)
 * 4. The worker checks every row with the same rules as a product made by
 *    hand (`validating`), makes a draft for each good row (`importing`), and
 *    writes a CSV of the rows that could not be imported (`completed`).
 */

export const READ_IMPORT_QUEUE = 'imports.read-file'
export const RUN_IMPORT_QUEUE = 'imports.create-drafts'

export const importQueues: QueueDefinition[] = [
  {
    name: READ_IMPORT_QUEUE,
    options: {
      retryLimit: 3,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 300,
      deleteAfterSeconds: 7 * 24 * 60 * 60,
    },
  },
  {
    name: RUN_IMPORT_QUEUE,
    options: {
      retryLimit: 3,
      retryDelay: 30,
      retryBackoff: true,
      // A file of 5,000 rows makes 5,000 drafts, one transaction each.
      expireInSeconds: 30 * 60,
      deleteAfterSeconds: 7 * 24 * 60 * 60,
    },
  },
]

export const readImportJob = z.object({
  importId: z.uuid(),
  uploadKey: z.string(),
})
export const runImportJob = z.object({ importId: z.uuid() })

const UPLOAD_FORM_SECONDS = 30 * 60
const DOWNLOAD_SECONDS = 5 * 60
const SAMPLE_ROWS = 5
const UPLOAD_KEY =
  /^uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/import-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const NOT_FOUND = 'There is no import with that id'

type SellerContext = Extract<RequestContext, { role: 'seller' }>
type ImportRow = typeof catalogueImports.$inferSelect

function assertSeller(
  context: RequestContext,
): asserts context is SellerContext {
  if (context.role !== 'seller') {
    throw new ForbiddenError('Only sellers can import a catalogue')
  }
}

const fileTypeOf = (fileName: string): ImportFileType =>
  fileName.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'csv'

const isImportStatus = (value: string): value is ImportStatus =>
  IMPORT_STATUSES.some((status) => status === value)
const isFileType = (value: string): value is ImportFileType =>
  IMPORT_FILE_TYPES.some((type) => type === value)

function toSummary(row: ImportRow): ImportSummary {
  if (!isImportStatus(row.status) || !isFileType(row.fileType)) {
    throw new Error(`Import ${row.id} has an unknown status or file type`)
  }
  return {
    id: row.id,
    fileName: row.originalFilename,
    fileType: row.fileType,
    status: row.status,
    totalRows: row.totalRows,
    okRows: row.okRows,
    errorRows: row.errorRows,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  }
}

async function findOwnImport(
  tx: Transaction,
  context: SellerContext,
  importId: string,
  { lock = false }: { lock?: boolean } = {},
): Promise<ImportRow> {
  if (!isUuid(importId)) throw new NotFoundError(NOT_FOUND)
  const query = tx
    .select()
    .from(catalogueImports)
    .where(
      and(
        eq(catalogueImports.id, importId),
        eq(catalogueImports.sellerId, context.sellerId),
      ),
    )
  const [row] = lock ? await query.for('update') : await query
  if (!row) throw new NotFoundError(NOT_FOUND)
  return row
}

/** The confirmed column mapping, checked again as it leaves the database. */
export const storedMapping = (row: {
  columnMapping: unknown
}): Record<string, ImportField> | null =>
  row.columnMapping === null
    ? null
    : importMapping.shape.columnMapping.parse(row.columnMapping)

async function toView(tx: Transaction, row: ImportRow): Promise<ImportView> {
  const sample = row.headers
    ? await tx
        .select({ raw: catalogueImportRows.raw })
        .from(catalogueImportRows)
        .where(eq(catalogueImportRows.importId, row.id))
        .orderBy(asc(catalogueImportRows.rowNumber))
        .limit(SAMPLE_ROWS)
    : []
  return {
    ...toSummary(row),
    headers: row.headers,
    columnMapping: storedMapping(row),
    sampleRows: sample.map((line) =>
      (row.headers ?? []).map((header) => line.raw[header] ?? ''),
    ),
    error: row.error,
    hasErrorReport: row.errorReportKey !== null,
    fields: IMPORT_FIELD_INFO,
  }
}

/** Signs a form the browser uploads the file with. */
export async function createImportUpload(
  storage: ObjectStorage,
  context: RequestContext,
  input: unknown,
): Promise<ImportUpload> {
  assertSeller(context)
  const { fileName } = parseInput(
    importUploadRequest,
    input,
    'That file cannot be uploaded',
  )
  const key = `uploads/${context.sellerId}/import-${randomUUID()}`
  const form = await storage.createUploadForm(key, {
    contentType: IMPORT_CONTENT_TYPES[fileTypeOf(fileName)],
    maxBytes: MAX_IMPORT_BYTES,
    expiresInSeconds: UPLOAD_FORM_SECONDS,
  })
  return {
    key,
    ...form,
    maxBytes: MAX_IMPORT_BYTES,
    expiresAt: new Date(Date.now() + UPLOAD_FORM_SECONDS * 1000),
  }
}

/**
 * Adds an uploaded file as a new import and queues the job that reads it,
 * in the same transaction.
 */
export async function createImport(
  tx: Transaction,
  queue: JobQueue,
  context: RequestContext,
  input: unknown,
): Promise<ImportView> {
  assertSeller(context)
  const { uploadKey, fileName } = parseInput(
    newImport,
    input,
    'That file cannot be imported',
  )
  if (UPLOAD_KEY.exec(uploadKey)?.[1] !== context.sellerId) {
    throw new ValidationError('That file cannot be imported', [
      'uploadKey is not one of your uploads',
    ])
  }
  const id = randomUUID()
  const fileType = fileTypeOf(fileName)
  const [row] = await tx
    .insert(catalogueImports)
    .values({
      id,
      sellerId: context.sellerId,
      uploadedBy: context.userId,
      // Where the worker keeps the file, privately, once it has read it.
      fileStorageKey: `imports/${id}/source.${fileType}`,
      originalFilename: fileName,
      fileType,
      status: 'uploaded',
    })
    .returning()
  await queue.send(tx, READ_IMPORT_QUEUE, { importId: id, uploadKey })
  return toView(tx, row!)
}

/** The seller's imports, newest first. */
export async function listImports(
  tx: Transaction,
  context: RequestContext,
  options: ImportListOptions = {},
): Promise<Page<ImportSummary>> {
  assertSeller(context)
  const limit = pageSize(options.limit)
  const conditions: SQL[] = [
    eq(catalogueImports.sellerId, context.sellerId),
    ...(options.cursor
      ? [
          afterCursor(
            options.cursor,
            catalogueImports.createdAt,
            catalogueImports.id,
          ),
        ]
      : []),
  ]
  const rows = await tx
    .select({
      row: catalogueImports,
      cursorTime: exactTime(catalogueImports.createdAt),
    })
    .from(catalogueImports)
    .where(and(...conditions))
    .orderBy(desc(catalogueImports.createdAt), desc(catalogueImports.id))
    .limit(limit + 1)
  return toPage(
    rows.map(({ row, cursorTime }) => ({ row, cursorTime, id: row.id })),
    limit,
    ({ row }) => toSummary(row),
    newestFirstCursor,
  )
}

export async function getImport(
  tx: Transaction,
  context: RequestContext,
  importId: string,
): Promise<ImportView> {
  assertSeller(context)
  return toView(tx, await findOwnImport(tx, context, importId))
}

/**
 * Says which column fills which field, then queues the job that makes the
 * drafts. Every required field needs a column, and a field takes at most one.
 */
export async function setImportMapping(
  tx: Transaction,
  queue: JobQueue,
  context: RequestContext,
  importId: string,
  input: unknown,
): Promise<ImportView> {
  assertSeller(context)
  const INVALID = 'That column mapping is not valid'
  const { columnMapping } = parseInput(importMapping, input, INVALID)
  const row = await findOwnImport(tx, context, importId, { lock: true })
  if (row.status !== 'uploaded' && row.status !== 'mapping_suggested') {
    throw new ConflictError(
      'The columns can be chosen only once, before the import runs',
    )
  }
  if (!row.headers) {
    throw new ConflictError(
      'The file is still being read; try again in a few seconds',
    )
  }
  const headers = new Set(row.headers)
  const issues: string[] = []
  for (const column of Object.keys(columnMapping)) {
    if (!headers.has(column)) {
      issues.push(`"${column}" is not a column of the file`)
    }
  }
  const mapped = Object.values(columnMapping)
  for (const { field, required } of IMPORT_FIELD_INFO) {
    const columns = mapped.filter((value) => value === field).length
    if (required && columns === 0) {
      issues.push(`${field} needs a column`)
    }
    if (columns > 1) issues.push(`${field} can come from only one column`)
  }
  if (issues.length > 0) throw new ValidationError(INVALID, issues)

  const [updated] = await tx
    .update(catalogueImports)
    .set({ columnMapping, status: 'mapping_confirmed' })
    .where(eq(catalogueImports.id, row.id))
    .returning()
  await queue.send(tx, RUN_IMPORT_QUEUE, { importId: row.id })
  return toView(tx, updated!)
}

/** A short-lived link to the CSV of rows that could not be imported. */
export async function getImportErrorReport(
  { db, storage }: { db: Database; storage: ObjectStorage },
  context: RequestContext,
  importId: string,
): Promise<ImportErrorReport> {
  assertSeller(context)
  const row = await withContext(db, context, (tx) =>
    findOwnImport(tx, context, importId),
  )
  if (!row.errorReportKey) {
    throw new ConflictError(
      row.status === 'completed'
        ? 'Every row was imported, so there is no error report'
        : 'The error report is ready once the import has finished',
    )
  }
  const fileName = `${row.originalFilename.replace(/\.(csv|xlsx)$/i, '')} - rows not imported.csv`
  // Counted before signing, so the link never outlives what this says.
  const expiresAt = new Date(Date.now() + DOWNLOAD_SECONDS * 1000)
  const url = await storage.createDownloadUrl(row.errorReportKey, {
    expiresInSeconds: DOWNLOAD_SECONDS,
    fileName,
  })
  return { url, expiresAt, fileName }
}
