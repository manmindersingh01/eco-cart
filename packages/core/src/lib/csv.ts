/*
 * Writes CSV files that EcoKart hands to people, such as an import's error
 * report. A cell that starts like a formula would run when the file is
 * opened in a spreadsheet, so it gets a leading apostrophe, which makes the
 * spreadsheet show it as text (OWASP's advice against CSV injection).
 */

const FORMULA_START = /^[=+\-@\t\r\n]/
// A plain number such as -125.50 is no formula, and must stay a number the
// spreadsheet can add up.
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/

const cell = (value: string) => {
  const safe =
    FORMULA_START.test(value) && !PLAIN_NUMBER.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}

/**
 * Every cell quoted, lines ending in CRLF (RFC 4180), and a byte order mark,
 * so Excel reads the rupee sign and other characters as UTF-8.
 */
export function toCsv(rows: readonly (readonly string[])[]): Buffer {
  const lines = rows.map((row) => `${row.map(cell).join(',')}\r\n`)
  return Buffer.from(`\ufeff${lines.join('')}`, 'utf8')
}
