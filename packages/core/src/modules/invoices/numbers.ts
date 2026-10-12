/*
 * Invoice numbers (backend spec step 14, design doc 6.6): each seller's own
 * sequence, starting again every Indian financial year. GST Rule 46 allows at
 * most 16 characters: letters, digits, "/" and "-".
 */

export const MAX_INVOICE_NUMBER_LENGTH = 16
const SEQUENCE_DIGITS = 6
const MAX_SEQUENCE = 10 ** SEQUENCE_DIGITS - 1

const kolkataYearAndMonth = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: 'numeric',
})

/**
 * The Indian financial year (1 April to 31 March) that `date` falls in,
 * counted in Asia/Kolkata, written like `2026-27`.
 */
export function financialYearOf(date: Date): string {
  const parts = kolkataYearAndMonth.formatToParts(date)
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  const start = month >= 4 ? year : year - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

/**
 * For example `GRB/2627/000041`: the seller's prefix, the financial year
 * 2026-27, and the 41st invoice of that year.
 */
export function formatInvoiceNumber(
  prefix: string,
  financialYear: string,
  sequence: number,
): string {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > MAX_SEQUENCE) {
    throw new Error(
      `Invoice sequence ${sequence} does not fit in ${SEQUENCE_DIGITS} digits`,
    )
  }
  const year = financialYear.replace(/^\d{2}(\d{2})-(\d{2})$/, '$1$2')
  const number = `${prefix}/${year}/${String(sequence).padStart(SEQUENCE_DIGITS, '0')}`
  if (number.length > MAX_INVOICE_NUMBER_LENGTH) {
    throw new Error(
      `Invoice number ${number} is longer than ${MAX_INVOICE_NUMBER_LENGTH} characters`,
    )
  }
  return number
}

/** A file name for the PDF, for example `GRB-2627-000041.pdf`. */
export const invoiceFileName = (invoiceNumber: string) =>
  `${invoiceNumber.replaceAll('/', '-')}.pdf`
