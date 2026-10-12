import { describe, expect, test } from 'vitest'
import {
  financialYearOf,
  formatInvoiceNumber,
  invoiceFileName,
} from './numbers.ts'

describe('financialYearOf', () => {
  test('runs from 1 April to 31 March', () => {
    expect(financialYearOf(new Date('2026-10-11T09:00:00Z'))).toBe('2026-27')
    expect(financialYearOf(new Date('2027-01-15T09:00:00Z'))).toBe('2026-27')
    expect(financialYearOf(new Date('2026-02-01T09:00:00Z'))).toBe('2025-26')
  })

  test('turns at midnight in India, not in UTC', () => {
    // 23:59:59.999 on 31 March in Asia/Kolkata.
    expect(financialYearOf(new Date('2027-03-31T18:29:59.999Z'))).toBe(
      '2026-27',
    )
    // 00:00 on 1 April in Asia/Kolkata, still 31 March in UTC.
    expect(financialYearOf(new Date('2027-03-31T18:30:00.000Z'))).toBe(
      '2027-28',
    )
  })

  test('writes the second year with two digits across a century', () => {
    expect(financialYearOf(new Date('2099-12-31T00:00:00Z'))).toBe('2099-00')
  })
})

describe('formatInvoiceNumber', () => {
  test('joins the prefix, the year, and a six-digit sequence', () => {
    expect(formatInvoiceNumber('GRB', '2026-27', 41)).toBe('GRB/2627/000041')
    expect(formatInvoiceNumber('GRBK', '2026-27', 999_999)).toBe(
      'GRBK/2627/999999',
    )
  })

  test('never goes over the 16 characters GST allows', () => {
    expect(() => formatInvoiceNumber('GRBK', '2026-27', 1_000_000)).toThrow(
      'does not fit in 6 digits',
    )
    expect(() => formatInvoiceNumber('GREENB', '2026-27', 1)).toThrow(
      'longer than 16 characters',
    )
  })

  test('starts at 1', () => {
    expect(() => formatInvoiceNumber('GRB', '2026-27', 0)).toThrow(
      'Invoice sequence 0 does not fit',
    )
    expect(() => formatInvoiceNumber('GRB', '2026-27', 1.5)).toThrow(
      'Invoice sequence 1.5 does not fit',
    )
  })
})

test('invoiceFileName has no slashes', () => {
  expect(invoiceFileName('GRB/2627/000041')).toBe('GRB-2627-000041.pdf')
})
