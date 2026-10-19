import type { InvoiceLine, InvoiceTotals } from './types.ts'

/*
 * Invoice lines from the order lines' frozen amounts (backend spec step 14).
 * Checkout already back-calculated each line's taxable value and tax from
 * the tax-inclusive price; the invoice only splits the tax and adds up.
 */

/** The order line values an invoice line is made from. */
export interface OrderLineForInvoice {
  id: string
  title: string
  sku: string
  options: Record<string, string>
  hsnCode: string
  gstRateBps: number
  unitPricePaise: number
  quantity: number
  lineTotalPaise: number
  discountSharePaise: number
  taxablePaise: number
  taxPaise: number
}

/**
 * Within one state the tax is half CGST and half SGST. An odd number of
 * paise cannot be halved, so CGST is rounded down and SGST takes the rest:
 * the two always add up to the tax frozen on the order line.
 */
export function splitTax(
  taxPaise: number,
  isInterstate: boolean,
): { cgstPaise: number; sgstPaise: number; igstPaise: number } {
  if (isInterstate) return { cgstPaise: 0, sgstPaise: 0, igstPaise: taxPaise }
  const cgstPaise = Math.floor(taxPaise / 2)
  return { cgstPaise, sgstPaise: taxPaise - cgstPaise, igstPaise: 0 }
}

export function invoiceLineFrom(
  line: OrderLineForInvoice,
  isInterstate: boolean,
): InvoiceLine {
  return {
    orderItemId: line.id,
    title: line.title,
    options: line.options,
    sku: line.sku,
    hsnCode: line.hsnCode,
    quantity: line.quantity,
    unitPricePaise: line.unitPricePaise,
    grossPaise: line.lineTotalPaise,
    discountPaise: line.discountSharePaise,
    taxablePaise: line.taxablePaise,
    gstRateBps: line.gstRateBps,
    ...splitTax(line.taxPaise, isInterstate),
    totalPaise: line.taxablePaise + line.taxPaise,
  }
}

export function invoiceTotals(lines: InvoiceLine[]): InvoiceTotals {
  const sum = (amount: (line: InvoiceLine) => number) =>
    lines.reduce((total, line) => total + amount(line), 0)
  return {
    taxablePaise: sum((line) => line.taxablePaise),
    cgstPaise: sum((line) => line.cgstPaise),
    sgstPaise: sum((line) => line.sgstPaise),
    igstPaise: sum((line) => line.igstPaise),
    totalPaise: sum((line) => line.totalPaise),
  }
}

export type DocumentTitle =
  'Tax Invoice' | 'Bill of Supply' | 'Invoice-cum-Bill of Supply'

/**
 * Goods at 0% GST go on a bill of supply (GST Rule 49). A consumer buying
 * taxed and 0% goods together gets one invoice-cum-bill of supply (Rule 46A).
 */
export function documentTitle(lines: InvoiceLine[]): DocumentTitle {
  const untaxed = lines.filter((line) => line.gstRateBps === 0).length
  if (untaxed === 0) return 'Tax Invoice'
  return untaxed === lines.length
    ? 'Bill of Supply'
    : 'Invoice-cum-Bill of Supply'
}
