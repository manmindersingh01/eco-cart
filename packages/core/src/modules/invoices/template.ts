import type { Content, createPdf, Size, TableCell, TableLayout } from 'pdfmake'
import { documentTitle } from './lines.ts'
import type { InvoiceDocument, InvoiceLine } from './types.ts'
import { amountInWords } from './words.ts'

/*
 * The invoice layout (backend spec step 14). It is a pure function from the
 * frozen invoice to a pdfmake document, which is plain data: the format the
 * chartered accountant approves can change here without touching any order
 * or invoice data (design doc section 10), and tests read it without making
 * a PDF. Only text goes in, never images or links taken from the invoice.
 */

export const INVOICE_FONT = 'NotoSans'

type DocumentDefinition = Parameters<typeof createPdf>[0]

const COLOUR = {
  text: '#1f2937',
  muted: '#6b7280',
  rule: '#d1d5db',
  heading: '#f3f4f6',
  cancelled: '#b91c1c',
  cancelledBorder: '#fca5a5',
  cancelledFill: '#fef2f2',
}
const MARGIN = 36

const wholeRupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

/**
 * ₹1,02,000.50 from 10200050 paise. The rupees are a whole number and the
 * paise are appended, so no amount passes through a fraction.
 */
export function formatPaise(paise: number): string {
  const rupees = wholeRupees.format(Math.floor(paise / 100))
  return `${rupees}.${String(paise % 100).padStart(2, '0')}`
}

/** 18% from 1800 basis points; 0.125% from 12.5 (half of 0.25%). */
const percent = (basisPoints: number) => `${basisPoints / 100}%`

const indianDate = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Kolkata',
})

/** +91 98000 00000 for an Indian mobile; anything else as stored. */
const phone = (value: string) =>
  value.replace(/^\+91([6-9]\d{4})(\d{5})$/, '+91 $1 $2')

const stateLabel = (code: string, name: string | null) =>
  name ? `${name} (${code})` : `State code ${code}`

const PAYMENT_METHOD = {
  razorpay: 'Paid online',
  cod: 'Cash on delivery',
} as const

const label = (text: string): Content => ({
  text,
  color: COLOUR.muted,
  fontSize: 8,
})

function details(rows: [string, string][]) {
  const widths: Size[] = ['auto', 'auto']
  return {
    table: {
      widths,
      body: rows.map(([name, value]): TableCell[] => [
        // Smaller than its value, so lowered onto the same baseline.
        { text: name, color: COLOUR.muted, fontSize: 8, margin: [0, 1, 0, 0] },
        { text: value, alignment: 'right' },
      ]),
    },
    layout: 'noBorders' as const,
  }
}

function sellerBlock({ seller }: InvoiceDocument): Content {
  const { address } = seller
  return {
    stack: [
      label('Sold by'),
      { text: seller.legalName, bold: true },
      ...(seller.displayName === seller.legalName
        ? []
        : [`Trading as ${seller.displayName}`]),
      address.line1,
      `${address.city} ${address.pincode}`,
      stateLabel(address.stateCode, address.stateName),
      { text: `GSTIN ${seller.gstin}`, bold: true, margin: [0, 2, 0, 0] },
      {
        text: `${seller.supportEmail}  ·  ${phone(seller.supportPhone)}`,
        color: COLOUR.muted,
      },
    ],
  }
}

function buyerBlock({ buyer }: InvoiceDocument): Content {
  const address = buyer.shippingAddress
  return {
    stack: [
      label('Bill to and ship to'),
      { text: address.fullName, bold: true },
      ...(buyer.name === address.fullName ? [] : [`Ordered by ${buyer.name}`]),
      address.line1,
      ...(address.line2 ? [address.line2] : []),
      ...(address.landmark ? [address.landmark] : []),
      `${address.city} ${address.pincode}`,
      stateLabel(address.stateCode, address.stateName),
    ],
  }
}

const lineTable: TableLayout = {
  hLineWidth: (row, node) =>
    row === 0 || row === 1 || row === node.table.body.length ? 0.75 : 0.25,
  vLineWidth: () => 0,
  hLineColor: () => COLOUR.rule,
  fillColor: (row) => (row === 0 ? COLOUR.heading : null),
  paddingLeft: () => 4,
  paddingRight: () => 4,
  paddingTop: () => 4,
  paddingBottom: () => 4,
}

const amount = (paise: number) => ({
  text: formatPaise(paise),
  alignment: 'right' as const,
  noWrap: true,
})

const tax = (rateBps: number, paise: number): TableCell => ({
  stack: [{ text: percent(rateBps), color: COLOUR.muted }, formatPaise(paise)],
  alignment: 'right',
  noWrap: true,
})

function itemCell(line: InvoiceLine): TableCell {
  const options = Object.entries(line.options).map(
    ([name, value]) => `${name}: ${value}`,
  )
  return {
    stack: [
      line.title,
      {
        text: [...options, `SKU ${line.sku}`].join('  ·  '),
        color: COLOUR.muted,
        fontSize: 7,
      },
    ],
  }
}

const hasDiscount = (invoice: InvoiceDocument) =>
  invoice.lines.some((line) => line.discountPaise > 0)

const heading = (text: string, alignment: 'left' | 'right' = 'right') => ({
  text,
  bold: true,
  alignment,
  noWrap: true,
})

function linesTable(invoice: InvoiceDocument): Content {
  const showDiscount = hasDiscount(invoice)
  const taxHeadings = invoice.isInterstate
    ? [heading('IGST')]
    : [heading('CGST'), heading('SGST')]
  const body: TableCell[][] = [
    [
      heading('#', 'left'),
      heading('Item', 'left'),
      heading('HSN', 'left'),
      heading('Qty'),
      heading('Unit price'),
      ...(showDiscount ? [heading('Discount')] : []),
      heading('Taxable value'),
      ...taxHeadings,
      heading('Total'),
    ],
    ...invoice.lines.map((line, index): TableCell[] => [
      String(index + 1),
      itemCell(line),
      line.hsnCode,
      { text: String(line.quantity), alignment: 'right' },
      amount(line.unitPricePaise),
      ...(showDiscount ? [amount(line.discountPaise)] : []),
      amount(line.taxablePaise),
      ...(invoice.isInterstate
        ? [tax(line.gstRateBps, line.igstPaise)]
        : [
            tax(line.gstRateBps / 2, line.cgstPaise),
            tax(line.gstRateBps / 2, line.sgstPaise),
          ]),
      { ...amount(line.totalPaise), bold: true },
    ]),
  ]
  return {
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: [
        'auto',
        '*',
        'auto',
        'auto',
        'auto',
        ...(showDiscount ? ['auto'] : []),
        'auto',
        ...taxHeadings.map(() => 'auto'),
        'auto',
      ],
      body,
    },
    layout: lineTable,
    fontSize: 8,
    margin: [0, 12, 0, 0],
  }
}

function totalsBlock(invoice: InvoiceDocument): Content {
  const rows: [string, number][] = [
    ['Taxable value', invoice.taxablePaise],
    ...(invoice.isInterstate
      ? ([['IGST', invoice.igstPaise]] as [string, number][])
      : ([
          ['CGST', invoice.cgstPaise],
          ['SGST', invoice.sgstPaise],
        ] as [string, number][])),
  ]
  return {
    columns: [
      {
        width: '*',
        stack: [
          label('Total in words'),
          { text: amountInWords(invoice.totalPaise), margin: [0, 2, 0, 0] },
        ],
        margin: [0, 4, 24, 0],
      },
      {
        width: 'auto',
        table: {
          widths: [90, 'auto'],
          body: [
            ...rows.map(([name, paise]) => [
              { text: name, color: COLOUR.muted },
              amount(paise),
            ]),
            [
              { text: 'Total', bold: true, fontSize: 11 },
              { ...amount(invoice.totalPaise), bold: true, fontSize: 11 },
            ],
          ],
        },
        layout: {
          hLineWidth: (row, node) =>
            row === node.table.body.length - 1 ? 0.75 : 0,
          vLineWidth: () => 0,
          hLineColor: () => COLOUR.rule,
        },
      },
    ],
    margin: [0, 12, 0, 0],
    unbreakable: true,
  }
}

/** A cancelled invoice says so at the top: when, and why. */
function cancellationNotice(cancelledAt: Date, reason: string): Content {
  return {
    table: {
      widths: ['*'],
      body: [
        [
          {
            stack: [
              {
                text: 'This invoice is cancelled.',
                bold: true,
                color: COLOUR.cancelled,
              },
              {
                text: `Cancelled on ${indianDate.format(cancelledAt)}. Reason: ${reason}`,
              },
            ],
            fillColor: COLOUR.cancelledFill,
          },
        ],
      ],
    },
    layout: {
      hLineColor: () => COLOUR.cancelledBorder,
      vLineColor: () => COLOUR.cancelledBorder,
      paddingLeft: () => 8,
      paddingRight: () => 8,
      paddingTop: () => 6,
      paddingBottom: () => 6,
    },
    margin: [0, 10, 0, 0],
  }
}

/** The pdfmake document for one invoice. */
export function invoiceDocumentDefinition(
  invoice: InvoiceDocument,
): DocumentDefinition {
  const title = documentTitle(invoice.lines)
  const { buyer, cancelledAt } = invoice
  const name = `${title} ${invoice.invoiceNumber}${cancelledAt ? ' (cancelled)' : ''}`
  const placeOfSupply = stateLabel(
    invoice.placeOfSupplyStateCode,
    buyer.shippingAddress.stateCode === invoice.placeOfSupplyStateCode
      ? buyer.shippingAddress.stateName
      : null,
  )
  return {
    pageSize: 'A4',
    pageMargins: [MARGIN, MARGIN, MARGIN, MARGIN + 16],
    info: {
      title: name,
      author: invoice.seller.legalName,
      subject: `Order ${buyer.orderNumber}`,
      creator: 'EcoKart',
      producer: 'EcoKart',
      creationDate: invoice.issuedAt,
    },
    defaultStyle: {
      font: INVOICE_FONT,
      fontSize: 9,
      lineHeight: 1.2,
      color: COLOUR.text,
    },
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: name },
        { text: `Page ${currentPage} of ${pageCount}`, alignment: 'right' },
      ],
      color: COLOUR.muted,
      fontSize: 7,
      margin: [MARGIN, 16, MARGIN, 0],
    }),
    ...(cancelledAt
      ? {
          watermark: {
            text: 'CANCELLED',
            color: COLOUR.cancelled,
            opacity: 0.08,
            bold: true,
          },
        }
      : {}),
    content: [
      {
        columns: [
          { text: title, fontSize: 18, bold: true, width: '*' },
          {
            width: 'auto',
            ...details([
              ['Invoice number', invoice.invoiceNumber],
              ['Invoice date', indianDate.format(invoice.issuedAt)],
              ['Order number', buyer.orderNumber],
              ['Order date', indianDate.format(new Date(buyer.orderPlacedAt))],
              ['Payment', PAYMENT_METHOD[buyer.paymentMethod]],
            ]),
          },
        ],
      },
      ...(cancelledAt
        ? [cancellationNotice(cancelledAt, invoice.cancelReason ?? '')]
        : []),
      {
        canvas: [
          {
            type: 'line',
            x1: 0,
            y1: 0,
            x2: 595.28 - 2 * MARGIN,
            y2: 0,
            lineWidth: 0.75,
            lineColor: COLOUR.rule,
          },
        ],
        margin: [0, 10, 0, 10],
      },
      {
        columns: [sellerBlock(invoice), buyerBlock(invoice)],
        columnGap: 24,
      },
      {
        columns: [
          {
            text: [
              { text: 'Place of supply  ', color: COLOUR.muted },
              placeOfSupply,
            ],
          },
          {
            text: [
              { text: 'Supply  ', color: COLOUR.muted },
              invoice.isInterstate
                ? 'Between states (IGST)'
                : 'Within the state (CGST and SGST)',
            ],
          },
          {
            text: [
              { text: 'Tax payable on reverse charge  ', color: COLOUR.muted },
              'No',
            ],
            alignment: 'right',
          },
        ],
        margin: [0, 12, 0, 0],
      },
      linesTable(invoice),
      {
        text: hasDiscount(invoice)
          ? 'Unit prices include GST. The taxable value is after the discount.'
          : 'Unit prices include GST.',
        color: COLOUR.muted,
        fontSize: 7,
        margin: [0, 4, 0, 0],
      },
      totalsBlock(invoice),
      {
        stack: [
          { text: `For ${invoice.seller.legalName}`, alignment: 'right' },
          {
            columns: [
              { text: 'This is a computer-generated invoice.' },
              { text: 'Authorised signatory', alignment: 'right' },
            ],
            color: COLOUR.muted,
            margin: [0, 28, 0, 0],
          },
        ],
        margin: [0, 24, 0, 0],
        unbreakable: true,
      },
    ],
  }
}
