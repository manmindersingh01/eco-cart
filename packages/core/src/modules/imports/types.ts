import { z } from 'zod'
import { strictObject } from '../../lib/validation.ts'

/* Catalogue import from CSV and Excel (backend step 8, design doc 6.7). */

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024
export const MAX_IMPORT_ROWS = 5000
export const MAX_IMPORT_COLUMNS = 50

export const IMPORT_FILE_TYPES = ['csv', 'xlsx'] as const
export type ImportFileType = (typeof IMPORT_FILE_TYPES)[number]

export const IMPORT_CONTENT_TYPES: Record<ImportFileType, string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export const IMPORT_STATUSES = [
  'uploaded',
  'mapping_suggested',
  'mapping_confirmed',
  'validating',
  'importing',
  'completed',
  'failed',
] as const
export type ImportStatus = (typeof IMPORT_STATUSES)[number]

/** The EcoKart fields a column can fill. Each row becomes one draft. */
export const IMPORT_FIELDS = [
  'title',
  'category',
  'sku',
  'price',
  'mrp',
  'stock',
  'description',
  'highlights',
  'brand',
  'hsnCode',
  'minOrderQuantity',
] as const
export type ImportField = (typeof IMPORT_FIELDS)[number]

export interface ImportFieldInfo {
  field: ImportField
  label: string
  required: boolean
  /** What the column should hold, for the mapping screen. */
  hint: string
}

export const IMPORT_FIELD_INFO: readonly ImportFieldInfo[] = [
  {
    field: 'title',
    label: 'Title',
    required: true,
    hint: 'The product name buyers see, 3 to 150 characters',
  },
  {
    field: 'category',
    label: 'Category',
    required: true,
    hint: 'The most specific category, by name or as a path such as Home & Kitchen > Kitchen & Dining > Bamboo Kitchenware',
  },
  {
    field: 'sku',
    label: 'SKU',
    required: true,
    hint: 'Your own code for the item, used by none of your other products',
  },
  {
    field: 'price',
    label: 'Price',
    required: true,
    hint: 'The selling price in rupees including GST, for example 1299 or 1,299.50',
  },
  {
    field: 'mrp',
    label: 'MRP',
    required: true,
    hint: 'The maximum retail price in rupees, at least the price',
  },
  {
    field: 'stock',
    label: 'Stock',
    required: true,
    hint: 'How many you have, a whole number',
  },
  {
    field: 'description',
    label: 'Description',
    required: false,
    hint: 'Up to 5,000 characters',
  },
  {
    field: 'highlights',
    label: 'Highlights',
    required: false,
    hint: 'Up to 8 short points, separated by | or on separate lines',
  },
  {
    field: 'brand',
    label: 'Brand',
    required: false,
    hint: 'An EcoKart brand name; leave empty for none',
  },
  {
    field: 'hsnCode',
    label: 'HSN code',
    required: false,
    hint: "4, 6, or 8 digits; leave empty to use the category's code",
  },
  {
    field: 'minOrderQuantity',
    label: 'Minimum quantity',
    required: false,
    hint: 'The fewest a buyer may order, from 1 to 1,000; leave empty for 1',
  },
]

export const importUploadRequest = strictObject({
  fileName: z
    .string()
    .trim()
    .min(1, 'must not be empty')
    .max(200, 'must be at most 200 characters')
    .regex(/\.(csv|xlsx)$/i, 'must end with .csv or .xlsx'),
  /** In bytes. */
  size: z
    .number()
    .int('must be a whole number')
    .min(1, 'must be at least 1 byte')
    .max(MAX_IMPORT_BYTES, 'must be at most 10 MB'),
})

export const newImport = strictObject({
  uploadKey: z.string(),
  fileName: importUploadRequest.shape.fileName,
})

export const importMapping = strictObject({
  /** The file's column heading to the EcoKart field it fills. */
  columnMapping: z.record(
    z.string(),
    z.enum(IMPORT_FIELDS, {
      error: `must be one of ${IMPORT_FIELDS.join(', ')}`,
    }),
  ),
})

/** Who suggested a column's field: its name, or the AI (step 19). */
export const SUGGESTION_SOURCES = ['name', 'ai'] as const
export type SuggestionSource = (typeof SUGGESTION_SOURCES)[number]

/** What the worker suggests for one column, before the seller chooses. */
export interface ColumnSuggestion {
  field: ImportField
  /** From 0 to 1: 1 for an exact field name, lower for a guess. */
  confidence: number
  source: SuggestionSource
}

export const columnSuggestions = z.record(
  z.string(),
  z.object({
    field: z.enum(IMPORT_FIELDS),
    confidence: z.number().min(0).max(1),
    source: z.enum(SUGGESTION_SOURCES),
  }),
)

export interface ImportListOptions {
  cursor?: string | undefined
  limit?: number | undefined
}

/** An import in the seller's list. */
export interface ImportSummary {
  id: string
  fileName: string
  fileType: ImportFileType
  status: ImportStatus
  totalRows: number
  okRows: number
  errorRows: number
  createdAt: Date
  completedAt: Date | null
}

export interface ImportView extends ImportSummary {
  /** The file's column headings; null until the worker has read it. */
  headers: string[] | null
  /** The columns the seller chose; null until they confirm. */
  columnMapping: Record<string, ImportField> | null
  /**
   * The worker's suggestion for the mapping screen, never applied by
   * itself; null until the file is read. A column left out has no
   * suggestion.
   */
  suggestedMapping: Record<string, ColumnSuggestion> | null
  /**
   * True while the AI is still looking at the columns the names did not
   * settle. The seller may choose the columns meanwhile.
   */
  suggestionPending: boolean
  /**
   * The first few rows as uploaded, each in the order of `headers`, for the
   * mapping screen.
   */
  sampleRows: string[][]
  /** Why the whole import stopped, when it failed. */
  error: string | null
  /** Whether a CSV of the rows that could not be imported can be downloaded. */
  hasErrorReport: boolean
  /** The fields a column can fill, for the mapping screen. */
  fields: readonly ImportFieldInfo[]
}

/** The signed form a browser uploads the file with. */
export interface ImportUpload {
  /** Pass back as `uploadKey` once the file is uploaded. */
  key: string
  url: string
  fields: Record<string, string>
  maxBytes: number
  expiresAt: Date
}

export interface ImportErrorReport {
  url: string
  expiresAt: Date
  fileName: string
}
