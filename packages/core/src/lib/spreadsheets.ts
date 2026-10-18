import { parse } from 'csv-parse/sync'
import { Unzip, UnzipInflate } from 'fflate'
import { readSheet } from 'read-excel-file/node'

/*
 * Reads a seller's CSV or XLSX catalogue file into a header row and data
 * rows of plain text (backend step 8). Runs only in the worker, which loads
 * the parsers. Every value stays text: a number in a workbook arrives as the
 * digits the file stores, so a price never passes through a floating-point
 * number on its way to paise.
 */

export type SpreadsheetType = 'csv' | 'xlsx'

/** A file that cannot be imported; the message is shown to the seller. */
export class SpreadsheetRejectedError extends Error {
  override name = 'SpreadsheetRejectedError'
}

export interface SpreadsheetLimits {
  /** Data rows, not counting the header row or empty rows. */
  maxRows: number
  maxColumns: number
}

export interface SpreadsheetRow {
  /** The row's number in the spreadsheet, where the header row is 1. */
  rowNumber: number
  values: string[]
}

export interface Spreadsheet {
  /** Unique and never empty: a blank or repeated heading gets a number. */
  headers: string[]
  rows: SpreadsheetRow[]
}

// An XLSX file is a ZIP archive, so a small file could unpack to gigabytes.
// No real catalogue sheet within the upload limit comes close to this.
const MAX_UNZIPPED_BYTES = 50 * 1024 * 1024

const NOT_UTF8 =
  'The file is not UTF-8 text; in Excel, save it as "CSV UTF-8 (Comma delimited)" and upload it again'
const NOT_XLSX = 'The file is not a readable Excel workbook (.xlsx)'

function readCsv(bytes: Buffer): unknown[][] {
  let text: string
  try {
    // Removes a byte order mark, which Excel writes at the start.
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new SpreadsheetRejectedError(NOT_UTF8)
  }
  try {
    return parse(text, {
      relax_column_count: true,
      trim: true,
      max_record_size: 100_000,
    })
  } catch (error) {
    const where =
      error instanceof Error &&
      'lines' in error &&
      typeof error.lines === 'number'
        ? ` near line ${error.lines}`
        : ''
    throw new SpreadsheetRejectedError(
      `The file is not valid CSV${where}; check that every quote is closed`,
    )
  }
}

/** Refuses a workbook that would unpack to more than the limit. */
function checkUnzippedSize(bytes: Buffer): void {
  let total = 0
  let tooLarge = false
  const unzip = new Unzip((file) => {
    file.ondata = (error, chunk) => {
      if (error || tooLarge) return
      total += chunk.length
      if (total > MAX_UNZIPPED_BYTES) {
        tooLarge = true
        file.terminate()
      }
    }
    file.start()
  })
  unzip.register(UnzipInflate)
  try {
    unzip.push(bytes, true)
  } catch {
    // Not a ZIP archive the checker can read; the workbook reader below
    // says what is wrong with it.
  }
  if (tooLarge) throw new SpreadsheetRejectedError(NOT_XLSX)
}

async function readXlsx(bytes: Buffer): Promise<unknown[][]> {
  checkUnzippedSize(bytes)
  try {
    return await readSheet(bytes, { parseNumber: (digits) => digits })
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'XLS_FILE_NOT_SUPPORTED'
    ) {
      throw new SpreadsheetRejectedError(
        'The file is an old Excel 97-2003 workbook (.xls); save it as .xlsx or CSV and upload it again',
      )
    }
    throw new SpreadsheetRejectedError(NOT_XLSX)
  }
}

/** A workbook's dates arrive as dates; everything else is already text. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (value instanceof Date) {
    const iso = value.toISOString()
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso
  }
  return typeof value === 'number' ? String(value) : ''
}

function uniqueHeaders(cells: string[]): string[] {
  const seen = new Set<string>()
  return cells.map((cell, index) => {
    const base = cell || `Column ${index + 1}`
    let name = base
    for (let n = 2; seen.has(name.toLowerCase()); n++) name = `${base} (${n})`
    seen.add(name.toLowerCase())
    return name
  })
}

export async function readSpreadsheet(
  bytes: Buffer,
  type: SpreadsheetType,
  limits: SpreadsheetLimits,
): Promise<Spreadsheet> {
  const records = type === 'csv' ? readCsv(bytes) : await readXlsx(bytes)
  const lines = records.map((record) => record.map(cellText))
  const headerIndex = lines.findIndex((line) => line.some(Boolean))
  if (headerIndex === -1) {
    throw new SpreadsheetRejectedError('The file is empty')
  }
  const headerCells = lines[headerIndex]!
  // Trailing blank headings are just empty columns.
  const width = headerCells.findLastIndex(Boolean) + 1
  if (width > limits.maxColumns) {
    throw new SpreadsheetRejectedError(
      `The file has ${width} columns; it can have at most ${limits.maxColumns}`,
    )
  }
  const headers = uniqueHeaders(headerCells.slice(0, width))

  const rows: SpreadsheetRow[] = []
  for (const [index, line] of lines.entries()) {
    if (index <= headerIndex || !line.some(Boolean)) continue
    if (rows.length === limits.maxRows) {
      throw new SpreadsheetRejectedError(
        `The file has more than ${limits.maxRows.toLocaleString('en-IN')} rows; split it into smaller files`,
      )
    }
    rows.push({
      rowNumber: index + 1,
      values: headers.map((_, column) => line[column] ?? ''),
    })
  }
  if (rows.length === 0) {
    throw new SpreadsheetRejectedError(
      'The file has a header row but no products below it',
    )
  }
  return { headers, rows }
}
