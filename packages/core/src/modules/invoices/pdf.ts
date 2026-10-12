import { fileURLToPath } from 'node:url'
import pdfmake from 'pdfmake'
import { INVOICE_FONT, invoiceDocumentDefinition } from './template.ts'
import type { InvoiceDocument } from './types.ts'

/*
 * Turns an invoice into PDF bytes with pdfmake. Only the worker loads this
 * file (through @ecokart/core/worker), so the web app never loads the PDF
 * library.
 */

// Noto Sans (SIL Open Font License) has the rupee sign; see assets/fonts.
const regular = fileURLToPath(
  new URL('../../../assets/fonts/NotoSans-Regular.ttf', import.meta.url),
)
const bold = fileURLToPath(
  new URL('../../../assets/fonts/NotoSans-Bold.ttf', import.meta.url),
)

export async function renderInvoicePdf(
  invoice: InvoiceDocument,
): Promise<Buffer> {
  pdfmake.setFonts({
    [INVOICE_FONT]: {
      normal: regular,
      bold,
      italics: regular,
      bolditalics: bold,
    },
  })
  // Invoices print text that sellers and buyers typed, so pdfmake may read
  // the two font files and nothing else, and never fetches a URL.
  pdfmake.setUrlAccessPolicy(() => false)
  pdfmake.setLocalAccessPolicy((path) => path === regular || path === bold)
  return pdfmake.createPdf(invoiceDocumentDefinition(invoice)).getBuffer()
}
