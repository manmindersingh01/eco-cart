import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import type { Database } from '../../db/client.ts'
import { invoices } from '../../db/schema/index.ts'
import type { ObjectStorage } from '../../lib/storage.ts'
import { renderInvoicePdf } from './pdf.ts'
import {
  invoicePdfKey,
  readInvoiceDocument,
  RENDER_INVOICE_QUEUE,
  renderInvoiceJob,
} from './service.ts'
import type { InvoiceDocument } from './types.ts'

/*
 * The worker's invoice jobs (backend spec step 14). Only the worker loads
 * this file, because it loads the PDF library.
 */

export interface InvoiceJobDependencies {
  /** Connected as ecokart_worker. */
  db: Database
  storage: ObjectStorage
}

/**
 * Makes the invoice's PDF from its frozen row, stores it privately, and
 * records where. Running it again replaces the file with a fresh one. Errors
 * are thrown so pg-boss retries; the last attempt also logs the invoice.
 */
export async function renderInvoice(
  deps: InvoiceJobDependencies,
  invoiceId: string,
  { lastAttempt = true }: { lastAttempt?: boolean } = {},
): Promise<void> {
  try {
    const invoice = await readInvoiceDocument(deps.db, invoiceId)
    if (invoice) await storeInvoicePdf(deps, invoice)
  } catch (error) {
    if (lastAttempt) {
      console.error(`Giving up on the PDF of invoice ${invoiceId}`, error)
    }
    throw error
  }
}

/**
 * Writes the PDF of `invoice` as it was read, and records it only if the
 * invoice is still in that state: a PDF made just before a cancellation
 * goes to its own file and is never recorded over the cancelled one.
 */
export async function storeInvoicePdf(
  deps: InvoiceJobDependencies,
  invoice: InvoiceDocument,
): Promise<void> {
  const key = invoicePdfKey(invoice)
  await deps.storage.write(key, await renderInvoicePdf(invoice), {
    contentType: 'application/pdf',
    // The buyer's address is on it, so no shared cache may keep a copy.
    cacheControl: 'private, no-store',
  })
  await deps.db
    .update(invoices)
    .set({ pdfStorageKey: key })
    .where(
      and(
        eq(invoices.id, invoice.id),
        invoice.cancelledAt
          ? isNotNull(invoices.cancelledAt)
          : isNull(invoices.cancelledAt),
      ),
    )
}

export async function registerInvoiceJobs(
  boss: PgBoss,
  deps: InvoiceJobDependencies,
): Promise<void> {
  await boss.work(
    RENDER_INVOICE_QUEUE,
    { includeMetadata: true },
    async ([job]) => {
      if (!job) return
      const { invoiceId } = renderInvoiceJob.parse(job.data)
      await renderInvoice(deps, invoiceId, {
        lastAttempt: job.retryCount >= job.retryLimit,
      })
    },
  )
}
