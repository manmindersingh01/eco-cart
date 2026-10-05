import { sql } from 'drizzle-orm'
import {
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { aiRequests } from './ai.ts'
import { users } from './auth.ts'
import { products } from './catalogue.ts'
import { createdAt, timestamptz, updatedAt, uuidPrimaryKey } from './columns.ts'
import {
  currentSellerId,
  fullAccess,
  webAll,
  webSelect,
  workerPolicy,
} from './rls.ts'
import { sellers } from './sellers.ts'

/** A seller's CSV or XLSX catalogue upload (design doc 5.11). */
export const catalogueImports = pgTable(
  'catalogue_imports',
  {
    id: uuidPrimaryKey(),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => sellers.id),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    fileStorageKey: text('file_storage_key').notNull(),
    originalFilename: text('original_filename').notNull(),
    fileType: text('file_type').notNull(),
    status: text('status').notNull().default('uploaded'),
    headers: text('headers').array(),
    // Seller column name to EcoKart field, e.g. {"Price (Rs)": "price"}.
    columnMapping: jsonb('column_mapping').$type<Record<string, string>>(),
    aiRequestId: uuid('ai_request_id').references(() => aiRequests.id),
    totalRows: integer('total_rows').notNull().default(0),
    okRows: integer('ok_rows').notNull().default(0),
    errorRows: integer('error_rows').notNull().default(0),
    errorReportKey: text('error_report_key'),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: timestamptz('completed_at'),
  },
  (t) => [
    index('catalogue_imports_seller_id_created_at_idx').on(
      t.sellerId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    check(
      'catalogue_imports_file_type_check',
      sql`file_type in ('csv', 'xlsx')`,
    ),
    check(
      'catalogue_imports_status_check',
      sql`status in ('uploaded', 'mapping_suggested', 'mapping_confirmed', 'validating', 'importing', 'completed', 'failed')`,
    ),
    check(
      'catalogue_imports_row_counts_check',
      sql`total_rows >= 0 and ok_rows >= 0 and error_rows >= 0 and ok_rows + error_rows <= total_rows`,
    ),
    webAll(sql`seller_id = ${currentSellerId} or ${fullAccess}`),
    workerPolicy(),
  ],
).enableRLS()

/**
 * One row per spreadsheet row, so the worker can process a large file in
 * batches, resume after a crash, and report errors per row.
 */
export const catalogueImportRows = pgTable(
  'catalogue_import_rows',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    importId: uuid('import_id')
      .notNull()
      .references(() => catalogueImports.id, { onDelete: 'cascade' }),
    rowNumber: integer('row_number').notNull(),
    raw: jsonb('raw').$type<Record<string, string>>().notNull(),
    normalized: jsonb('normalized'),
    status: text('status').notNull().default('pending'),
    errorMessage: text('error_message'),
    productId: uuid('product_id').references(() => products.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('catalogue_import_rows_import_id_row_number_key').on(
      t.importId,
      t.rowNumber,
    ),
    index('catalogue_import_rows_import_id_status_idx').on(
      t.importId,
      t.status,
    ),
    check(
      'catalogue_import_rows_status_check',
      sql`status in ('pending', 'ok', 'error')`,
    ),
    check('catalogue_import_rows_row_number_check', sql`row_number > 0`),
    webSelect(
      sql`exists (select 1 from catalogue_imports i where i.id = catalogue_import_rows.import_id)`,
    ),
    workerPolicy(),
  ],
).enableRLS()
