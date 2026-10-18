import { randomUUID } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import {
  documentTitle,
  invoiceLineFrom,
  invoiceTotals,
  splitTax,
  type OrderLineForInvoice,
} from './lines.ts'
import { formatPaise } from './template.ts'

/** A ₹500 line at 18%, with ₹76.27 of tax, as checkout freezes it. */
const orderLine = (
  changes: Partial<OrderLineForInvoice> = {},
): OrderLineForInvoice => ({
  id: randomUUID(),
  title: 'Steel Bottle, 750 ml',
  sku: 'SB-750',
  options: { Colour: 'Silver' },
  hsnCode: '7323',
  gstRateBps: 1800,
  unitPricePaise: 50_000,
  quantity: 1,
  lineTotalPaise: 50_000,
  discountSharePaise: 0,
  taxablePaise: 42_373,
  taxPaise: 7_627,
  ...changes,
})

describe('splitTax', () => {
  test('halves tax within a state, rounding CGST down', () => {
    expect(splitTax(7_627, false)).toEqual({
      cgstPaise: 3_813,
      sgstPaise: 3_814,
      igstPaise: 0,
    })
    expect(splitTax(1_800, false)).toEqual({
      cgstPaise: 900,
      sgstPaise: 900,
      igstPaise: 0,
    })
  })

  test('puts all tax on IGST between states', () => {
    expect(splitTax(7_627, true)).toEqual({
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 7_627,
    })
  })
})

describe('invoice lines', () => {
  test('keep the order line’s frozen amounts', () => {
    const line = orderLine({
      quantity: 2,
      lineTotalPaise: 1_00_000,
      discountSharePaise: 10_000,
      taxablePaise: 76_271,
      taxPaise: 13_729,
    })
    expect(invoiceLineFrom(line, false)).toEqual({
      orderItemId: line.id,
      title: 'Steel Bottle, 750 ml',
      options: { Colour: 'Silver' },
      sku: 'SB-750',
      hsnCode: '7323',
      quantity: 2,
      unitPricePaise: 50_000,
      grossPaise: 1_00_000,
      discountPaise: 10_000,
      taxablePaise: 76_271,
      gstRateBps: 1800,
      cgstPaise: 6_864,
      sgstPaise: 6_865,
      igstPaise: 0,
      totalPaise: 90_000,
    })
  })

  test('add up to the totals', () => {
    const lines = [
      invoiceLineFrom(orderLine(), false),
      invoiceLineFrom(
        orderLine({
          gstRateBps: 500,
          unitPricePaise: 19_900,
          lineTotalPaise: 19_900,
          taxablePaise: 18_952,
          taxPaise: 948,
        }),
        false,
      ),
    ]
    expect(invoiceTotals(lines)).toEqual({
      taxablePaise: 61_325,
      cgstPaise: 3_813 + 474,
      sgstPaise: 3_814 + 474,
      igstPaise: 0,
      totalPaise: 69_900,
    })
  })
})

describe('documentTitle', () => {
  const taxed = invoiceLineFrom(orderLine(), false)
  const untaxed = invoiceLineFrom(
    orderLine({ gstRateBps: 0, taxablePaise: 50_000, taxPaise: 0 }),
    false,
  )

  test('is a tax invoice when every line is taxed', () => {
    expect(documentTitle([taxed, taxed])).toBe('Tax Invoice')
  })

  test('is a bill of supply when no line is', () => {
    expect(documentTitle([untaxed])).toBe('Bill of Supply')
  })

  test('is an invoice-cum-bill of supply for a mix', () => {
    expect(documentTitle([taxed, untaxed])).toBe('Invoice-cum-Bill of Supply')
  })
})

test('formatPaise prints rupees exactly, with Indian grouping', () => {
  expect(formatPaise(1_02_000_50)).toBe('₹1,02,000.50')
  expect(formatPaise(1)).toBe('₹0.01')
  expect(formatPaise(99_99_99_999_99)).toBe('₹99,99,99,999.99')
})
