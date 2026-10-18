import { z } from 'zod'

/*
 * What an invoice freezes when it is issued (backend spec step 14). The
 * jsonb columns are read back through these schemas, so a damaged row fails
 * loudly instead of printing a wrong invoice.
 */

const wholePaise = z.number().int().min(0)

export const invoiceSellerSnapshot = z.object({
  legalName: z.string(),
  displayName: z.string(),
  gstin: z.string(),
  address: z.object({
    line1: z.string(),
    city: z.string(),
    stateCode: z.string(),
    stateName: z.string().nullable(),
    pincode: z.string(),
  }),
  supportEmail: z.string(),
  supportPhone: z.string(),
})
export type InvoiceSellerSnapshot = z.infer<typeof invoiceSellerSnapshot>

/**
 * The buyer and their order as the invoice prints them. The buyer's phone
 * and email are left out: GST does not need them, and invoices get passed on.
 * The buyer's account id is kept, not printed, so the invoices module can
 * tell who may download the invoice without reading the orders tables.
 */
export const invoiceBuyerSnapshot = z.object({
  userId: z.uuid(),
  name: z.string(),
  shippingAddress: z.object({
    fullName: z.string(),
    line1: z.string(),
    line2: z.string().nullable(),
    landmark: z.string().nullable(),
    city: z.string(),
    stateCode: z.string(),
    stateName: z.string().nullable(),
    pincode: z.string(),
  }),
  orderNumber: z.string(),
  orderPlacedAt: z.iso.datetime({ offset: true }),
  paymentMethod: z.enum(['razorpay', 'cod']),
})
export type InvoiceBuyerSnapshot = z.infer<typeof invoiceBuyerSnapshot>

/** One line exactly as printed; amounts are whole paise. */
export const invoiceLine = z.object({
  orderItemId: z.uuid(),
  title: z.string(),
  options: z.record(z.string(), z.string()),
  sku: z.string(),
  hsnCode: z.string(),
  quantity: z.number().int().positive(),
  /** Tax inclusive, before the discount. */
  unitPricePaise: wholePaise,
  /** Unit price times quantity. */
  grossPaise: wholePaise,
  discountPaise: wholePaise,
  taxablePaise: wholePaise,
  gstRateBps: z.number().int().min(0).max(10_000),
  cgstPaise: wholePaise,
  sgstPaise: wholePaise,
  igstPaise: wholePaise,
  /** Taxable value plus tax: what the buyer pays for the line. */
  totalPaise: wholePaise,
})
export type InvoiceLine = z.infer<typeof invoiceLine>

export const invoiceLines = z.array(invoiceLine).min(1)

export interface InvoiceTotals {
  taxablePaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  totalPaise: number
}

/** Everything the PDF prints, read from one invoice row. */
export interface InvoiceDocument extends InvoiceTotals {
  id: string
  sellerId: string
  invoiceNumber: string
  issuedAt: Date
  seller: InvoiceSellerSnapshot
  buyer: InvoiceBuyerSnapshot
  placeOfSupplyStateCode: string
  isInterstate: boolean
  lines: InvoiceLine[]
  /** Set when the order was cancelled before dispatch. */
  cancelledAt: Date | null
  cancelReason: string | null
}

const orderLineToInvoice = z.object({
  /** The order line's id. */
  id: z.uuid(),
  sellerId: z.uuid(),
  title: z.string(),
  sku: z.string(),
  options: z.record(z.string(), z.string()),
  hsnCode: z.string(),
  gstRateBps: z.number().int().min(0).max(10_000),
  unitPricePaise: wholePaise,
  quantity: z.number().int().positive(),
  lineTotalPaise: wholePaise,
  discountSharePaise: wholePaise,
  taxablePaise: wholePaise,
  taxPaise: wholePaise,
})

/**
 * The confirmed order as payment confirmation (step 12) hands it over: the
 * invoices module never reads the orders tables itself. `lines` are the
 * lines to invoice, in the order the buyer sees them; cancelled lines are
 * left out.
 */
export const orderToInvoice = z.object({
  orderId: z.uuid(),
  orderNumber: z.string().min(1),
  placedAt: z.date(),
  paymentMethod: z.enum(['razorpay', 'cod']),
  buyer: z.object({
    userId: z.uuid(),
    name: z.string(),
    shippingAddress: z.object({
      fullName: z.string(),
      line1: z.string(),
      line2: z.string().nullable(),
      landmark: z.string().nullable(),
      city: z.string(),
      stateCode: z.string().regex(/^\d{2}$/),
      pincode: z.string(),
    }),
  }),
  lines: z.array(orderLineToInvoice).min(1),
})
export type OrderToInvoice = z.input<typeof orderToInvoice>

/** What `issueInvoices` returns for each seller's invoice. */
export interface IssuedInvoice {
  id: string
  sellerId: string
  invoiceNumber: string
}

/** An invoice in a list. */
export interface InvoiceSummary extends InvoiceTotals {
  id: string
  invoiceNumber: string
  orderId: string
  orderNumber: string
  sellerId: string
  sellerName: string
  buyerName: string
  issuedAt: Date
  placeOfSupplyStateCode: string
  isInterstate: boolean
  /** Whether the PDF can be downloaded yet. */
  pdfReady: boolean
  /** Set when the order was cancelled; the number stays used. */
  cancelledAt: Date | null
  cancelReason: string | null
}

export interface InvoiceDownload {
  /** A signed link to the PDF; it stops working at `expiresAt`. */
  url: string
  expiresAt: Date
  fileName: string
}
