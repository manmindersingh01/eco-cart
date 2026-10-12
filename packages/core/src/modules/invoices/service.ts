import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm'
import type { PgInsertValue } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import type { Database, Transaction } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { invoices } from '../../db/schema/index.ts'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  NotSignedInError,
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
import { stateName } from '../../lib/states.ts'
import type { ObjectStorage } from '../../lib/storage.ts'
import { uniqueViolation } from '../../lib/postgres.ts'
import {
  idOf,
  isUuid,
  parseInput,
  strictObject,
  text,
} from '../../lib/validation.ts'
import { recordAuditEntry } from '../audit/service.ts'
import { takeInvoiceNumber } from '../sellers/service.ts'
import { invoiceLineFrom, invoiceTotals } from './lines.ts'
import {
  financialYearOf,
  formatInvoiceNumber,
  invoiceFileName,
} from './numbers.ts'
import {
  invoiceBuyerSnapshot,
  invoiceLines,
  invoiceSellerSnapshot,
  orderToInvoice,
  type InvoiceBuyerSnapshot,
  type InvoiceDocument,
  type InvoiceDownload,
  type InvoiceSellerSnapshot,
  type InvoiceSummary,
  type IssuedInvoice,
  type OrderToInvoice,
} from './types.ts'

/*
 * GST invoices (backend spec step 14, design doc 6.6): one per order per
 * seller, numbered and frozen inside the payment confirmation transaction,
 * and turned into a PDF by the worker (jobs.ts).
 */

export const RENDER_INVOICE_QUEUE = 'invoices.render-pdf'

export const invoiceQueues: QueueDefinition[] = [
  {
    name: RENDER_INVOICE_QUEUE,
    options: {
      // 30 seconds doubling five times: about fifteen minutes in all, enough
      // to ride out a short storage or database outage.
      retryLimit: 5,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 120,
      deleteAfterSeconds: 7 * 24 * 60 * 60,
    },
  },
]

export const renderInvoiceJob = z.object({ invoiceId: z.uuid() })

/**
 * Where an invoice's PDF is stored; the bucket keeps it private. A cancelled
 * invoice's PDF is a file of its own, so a PDF made just before the
 * cancellation can never overwrite it.
 */
export const invoicePdfKey = (invoice: {
  id: string
  sellerId: string
  cancelledAt: Date | null
}) =>
  `invoices/${invoice.sellerId}/${invoice.id}${invoice.cancelledAt ? '-cancelled' : ''}.pdf`

const DOWNLOAD_SECONDS = 5 * 60
const NOT_FOUND = 'There is no invoice with that id'

type SignedInContext = Exclude<RequestContext, { role: 'anonymous' }>

function assertSignedIn(
  context: RequestContext,
): asserts context is SignedInContext {
  if (context.role === 'anonymous') throw new NotSignedInError()
}

/**
 * The database's clock for this transaction, so every row agrees on it.
 * Throws unless the transaction runs as `system` (or `admin`): row-level
 * security would otherwise hide rows these changes need, and they would
 * fail with a misleading message.
 */
async function systemTransactionTime(tx: Transaction): Promise<Date> {
  // Drizzle's driver leaves times as text, so the time travels as exact UTC.
  const result = await tx.execute<{ now: string; fullAccess: boolean }>(
    sql`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "now", app.has_full_access() as "fullAccess"`,
  )
  const { now, fullAccess } = result.rows[0]!
  if (!fullAccess) {
    throw new Error(
      'Invoices are issued and cancelled only in a system transaction',
    )
  }
  return new Date(now)
}

/**
 * Issues one invoice for each seller in a confirmed order, inside the
 * caller's transaction, which must run as `system`. Payment confirmation
 * (step 12) calls it after marking the order confirmed, and so does cash on
 * delivery checkout. The caller hands over the order's frozen details, so
 * the invoices module never reads the orders tables, and holds the order's
 * row lock, so two confirmations of one order take turns.
 *
 * Each seller's sequence row is locked in order of seller id, so
 * confirmations that share sellers never deadlock. Calling it again for the
 * same order issues nothing and returns the invoices that exist.
 */
export async function issueInvoices(
  tx: Transaction,
  queue: JobQueue,
  input: OrderToInvoice,
): Promise<IssuedInvoice[]> {
  const order = orderToInvoice.parse(input)
  const now = await systemTransactionTime(tx)

  const existing = await tx
    .select({
      id: invoices.id,
      sellerId: invoices.sellerId,
      invoiceNumber: invoices.invoiceNumber,
    })
    .from(invoices)
    .where(eq(invoices.orderId, order.orderId))
  const invoiced = new Set(existing.map((invoice) => invoice.sellerId))

  const linesBySeller = Map.groupBy(order.lines, (line) => line.sellerId)
  const sellerIds = [...linesBySeller.keys()]
    .filter((sellerId) => !invoiced.has(sellerId))
    .toSorted()
  if (sellerIds.length === 0) return existing

  const financialYear = financialYearOf(now)
  const { shippingAddress } = order.buyer
  const buyer: InvoiceBuyerSnapshot = {
    userId: order.buyer.userId,
    name: order.buyer.name,
    shippingAddress: {
      ...shippingAddress,
      stateName: stateName(shippingAddress.stateCode) ?? null,
    },
    orderNumber: order.orderNumber,
    orderPlacedAt: order.placedAt.toISOString(),
    paymentMethod: order.paymentMethod,
  }

  const issued: IssuedInvoice[] = []
  for (const sellerId of sellerIds) {
    const { sequence, seller } = await takeInvoiceNumber(
      tx,
      sellerId,
      financialYear,
    )
    // Approval needs a GSTIN, and an approved seller can never lose it.
    if (!seller.gstin) {
      throw new Error(`Seller ${sellerId} has no GSTIN to invoice with`)
    }
    const sellerSnapshot: InvoiceSellerSnapshot = {
      legalName: seller.legalName,
      displayName: seller.displayName,
      gstin: seller.gstin,
      address: {
        line1: seller.line1,
        city: seller.city,
        stateCode: seller.stateCode,
        stateName: stateName(seller.stateCode) ?? null,
        pincode: seller.pincode,
      },
      supportEmail: seller.supportEmail,
      supportPhone: seller.supportPhone,
    }
    // Goods are supplied where they are delivered.
    const isInterstate = seller.stateCode !== shippingAddress.stateCode
    const lines = linesBySeller
      .get(sellerId)!
      .map((line) => invoiceLineFrom(line, isInterstate))
    const invoice = await insertInvoice(tx, {
      orderId: order.orderId,
      sellerId,
      invoiceNumber: formatInvoiceNumber(
        seller.invoicePrefix,
        financialYear,
        sequence,
      ),
      issuedAt: sql`now()`,
      sellerSnapshot,
      buyerSnapshot: buyer,
      placeOfSupplyStateCode: shippingAddress.stateCode,
      isInterstate,
      ...invoiceTotals(lines),
      lines,
    })
    await queue.send(tx, RENDER_INVOICE_QUEUE, { invoiceId: invoice.id })
    issued.push(invoice)
  }
  return [...existing, ...issued]
}

/**
 * Saves one invoice. A caller that forgot the order's row lock can race a
 * second confirmation of the same order here; the unique (order, seller)
 * rule then refuses the second, which rolls back with its number.
 */
async function insertInvoice(
  tx: Transaction,
  values: PgInsertValue<typeof invoices>,
): Promise<IssuedInvoice> {
  try {
    const [invoice] = await tx.insert(invoices).values(values).returning({
      id: invoices.id,
      sellerId: invoices.sellerId,
      invoiceNumber: invoices.invoiceNumber,
    })
    return invoice!
  } catch (error) {
    if (uniqueViolation(error) === 'invoices_order_id_seller_id_key') {
      throw new ConflictError(
        'This order’s invoices are being issued by another request; try again',
      )
    }
    throw error
  }
}

const cancellation = strictObject({
  orderId: idOf('an order'),
  reason: text(500),
})

/**
 * Cancels every invoice of an order cancelled before dispatch (step 13),
 * inside the caller's transaction, which runs as `system` and holds the
 * order's row lock. Each number stays used, as GST requires, and each PDF is
 * made again with "Cancelled" on it; until then the old one cannot be
 * downloaded. Returns the invoices this call cancelled, so calling it again
 * changes nothing and returns none.
 */
export async function cancelInvoices(
  tx: Transaction,
  queue: JobQueue,
  input: { orderId: string; reason: string },
): Promise<IssuedInvoice[]> {
  const { orderId, reason } = parseInput(
    cancellation,
    input,
    'Those invoices cannot be cancelled',
  )
  await systemTransactionTime(tx)
  const cancelled = await tx
    .update(invoices)
    .set({ cancelledAt: sql`now()`, cancelReason: reason, pdfStorageKey: null })
    .where(and(eq(invoices.orderId, orderId), isNull(invoices.cancelledAt)))
    .returning({
      id: invoices.id,
      sellerId: invoices.sellerId,
      invoiceNumber: invoices.invoiceNumber,
    })
  for (const invoice of cancelled) {
    await queue.send(tx, RENDER_INVOICE_QUEUE, { invoiceId: invoice.id })
  }
  return cancelled
}

const buyerUserId = sql<string>`${invoices.buyerSnapshot} ->> 'userId'`

const summaryColumns = {
  id: invoices.id,
  invoiceNumber: invoices.invoiceNumber,
  orderId: invoices.orderId,
  orderNumber: sql<string>`${invoices.buyerSnapshot} ->> 'orderNumber'`,
  sellerId: invoices.sellerId,
  sellerName: sql<string>`${invoices.sellerSnapshot} ->> 'legalName'`,
  buyerName: sql<string>`${invoices.buyerSnapshot} ->> 'name'`,
  issuedAt: invoices.issuedAt,
  placeOfSupplyStateCode: invoices.placeOfSupplyStateCode,
  isInterstate: invoices.isInterstate,
  taxablePaise: invoices.taxablePaise,
  cgstPaise: invoices.cgstPaise,
  sgstPaise: invoices.sgstPaise,
  igstPaise: invoices.igstPaise,
  totalPaise: invoices.totalPaise,
  pdfReady: sql<boolean>`${invoices.pdfStorageKey} is not null`,
  cancelledAt: invoices.cancelledAt,
  cancelReason: invoices.cancelReason,
}

async function selectSummaries(
  tx: Transaction,
  where: SQL | undefined,
): Promise<InvoiceSummary[]> {
  return tx
    .select(summaryColumns)
    .from(invoices)
    .where(where)
    .orderBy(asc(invoices.issuedAt), asc(invoices.invoiceNumber))
}

/**
 * The invoice if `context` may see it: the buyer of the order, the issuing
 * seller, or an administrator. Anyone else gets 404, as if it did not exist.
 */
async function findVisibleInvoice(
  tx: Transaction,
  context: SignedInContext,
  invoiceId: string,
) {
  if (!isUuid(invoiceId)) throw new NotFoundError(NOT_FOUND)
  const [invoice] = await tx
    .select({
      id: invoices.id,
      orderId: invoices.orderId,
      sellerId: invoices.sellerId,
      invoiceNumber: invoices.invoiceNumber,
      pdfStorageKey: invoices.pdfStorageKey,
      buyerUserId: buyerUserId,
    })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
  if (!invoice) throw new NotFoundError(NOT_FOUND)
  const visible =
    context.role === 'admin' ||
    context.role === 'system' ||
    (context.role === 'seller' && invoice.sellerId === context.sellerId) ||
    (context.role === 'buyer' && invoice.buyerUserId === context.userId)
  if (!visible) throw new NotFoundError(NOT_FOUND)
  return invoice
}

/**
 * The invoices of one order that `context` may see: all of them for the
 * buyer and administrators, and only their own for a seller. Anyone else
 * gets an empty list, which says nothing about whether the order exists.
 * Step 13's order screens show these.
 */
export async function listOrderInvoices(
  tx: Transaction,
  context: RequestContext,
  orderId: string,
): Promise<InvoiceSummary[]> {
  assertSignedIn(context)
  if (!isUuid(orderId)) return []
  const ofOrder = eq(invoices.orderId, orderId)
  if (context.role === 'admin' || context.role === 'system') {
    return selectSummaries(tx, ofOrder)
  }
  if (context.role === 'seller') {
    return selectSummaries(
      tx,
      and(ofOrder, eq(invoices.sellerId, context.sellerId)),
    )
  }
  return selectSummaries(
    tx,
    and(ofOrder, sql`${buyerUserId} = ${context.userId}`),
  )
}

/** A seller's own invoices, newest first, a page at a time. */
export async function listOwnInvoices(
  tx: Transaction,
  context: RequestContext,
  options: { cursor?: string; limit?: number } = {},
): Promise<Page<InvoiceSummary>> {
  if (context.role !== 'seller') {
    throw new ForbiddenError('This needs a seller account')
  }
  const limit = pageSize(options.limit)
  const rows = await tx
    .select({ ...summaryColumns, cursorTime: exactTime(invoices.issuedAt) })
    .from(invoices)
    .where(
      and(
        eq(invoices.sellerId, context.sellerId),
        options.cursor
          ? afterCursor(options.cursor, invoices.issuedAt, invoices.id)
          : undefined,
      ),
    )
    .orderBy(desc(invoices.issuedAt), desc(invoices.id))
    .limit(limit + 1)
  return toPage(
    rows,
    limit,
    ({ cursorTime: _cursor, ...summary }) => summary,
    newestFirstCursor,
  )
}

/**
 * A five-minute link to the invoice's PDF, for the buyer, the issuing
 * seller, or an administrator. The link is signed outside the transaction.
 */
export async function getInvoiceDownload(
  { db, storage }: { db: Database; storage: ObjectStorage },
  context: RequestContext,
  invoiceId: string,
): Promise<InvoiceDownload> {
  assertSignedIn(context)
  const invoice = await withContext(db, context, (tx) =>
    findVisibleInvoice(tx, context, invoiceId),
  )
  if (!invoice.pdfStorageKey) {
    throw new ConflictError(
      'The invoice PDF is still being made; try again in a minute',
    )
  }
  const fileName = invoiceFileName(invoice.invoiceNumber)
  // Counted before signing, so the link never outlives what this says.
  const expiresAt = new Date(Date.now() + DOWNLOAD_SECONDS * 1000)
  const url = await storage.createDownloadUrl(invoice.pdfStorageKey, {
    expiresInSeconds: DOWNLOAD_SECONDS,
    fileName,
  })
  return { url, expiresAt, fileName }
}

/**
 * An administrator has the PDF made again, for example after the template
 * changed. The invoice's frozen data stays as it is.
 */
export async function rerenderInvoice(
  tx: Transaction,
  queue: JobQueue,
  context: RequestContext,
  invoiceId: string,
): Promise<InvoiceSummary> {
  if (context.role !== 'admin' && context.role !== 'system') {
    throw new ForbiddenError('Only administrators can make invoice PDFs again')
  }
  const invoice = await findVisibleInvoice(tx, context, invoiceId)
  await queue.send(tx, RENDER_INVOICE_QUEUE, { invoiceId: invoice.id })
  await recordAuditEntry(tx, {
    actorUserId: context.userId ?? null,
    actorRole: context.role,
    action: 'invoice.render',
    entityType: 'invoice',
    entityId: invoice.id,
    after: { invoiceNumber: invoice.invoiceNumber },
  })
  const [summary] = await selectSummaries(tx, eq(invoices.id, invoice.id))
  return summary!
}

/**
 * Everything the PDF prints, from the invoice row alone, or null when the
 * invoice does not exist. The frozen data is checked as it is read.
 */
export async function readInvoiceDocument(
  db: Database | Transaction,
  invoiceId: string,
): Promise<InvoiceDocument | null> {
  const [row] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
  if (!row) return null
  return {
    id: row.id,
    sellerId: row.sellerId,
    invoiceNumber: row.invoiceNumber,
    issuedAt: row.issuedAt,
    seller: invoiceSellerSnapshot.parse(row.sellerSnapshot),
    buyer: invoiceBuyerSnapshot.parse(row.buyerSnapshot),
    placeOfSupplyStateCode: row.placeOfSupplyStateCode,
    isInterstate: row.isInterstate,
    lines: invoiceLines.parse(row.lines),
    taxablePaise: row.taxablePaise,
    cgstPaise: row.cgstPaise,
    sgstPaise: row.sgstPaise,
    igstPaise: row.igstPaise,
    totalPaise: row.totalPaise,
    cancelledAt: row.cancelledAt,
    cancelReason: row.cancelReason,
  }
}
