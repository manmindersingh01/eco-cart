import { describe, expect, test } from 'vitest'
import {
  formatBasisPoints,
  formatIndianDate,
  formatInr,
  formatStatusLabel,
} from './format'

describe('frontend formatters', () => {
  test('formats paise as Indian rupees with two decimal places', () => {
    expect(formatInr(19_900)).toBe('₹199.00')
    expect(formatInr(10_000_000)).toBe('₹1,00,000.00')
  })

  test('formats basis points as a percentage', () => {
    expect(formatBasisPoints(1_000)).toBe('10%')
    expect(formatBasisPoints(1_250)).toBe('12.5%')
  })

  test('formats dates in Asia/Kolkata', () => {
    expect(formatIndianDate('2026-10-08T20:00:00.000Z')).toBe('09 Oct 2026')
    expect(
      formatIndianDate('2026-10-08T20:00:00.000Z', { includeTime: true }),
    ).toContain('09 Oct 2026')
    expect(
      formatIndianDate('2026-10-08T20:00:00.000Z', { includeTime: true }),
    ).toContain('1:30 am')
  })

  test('turns stored status values into readable labels', () => {
    expect(formatStatusLabel('pending_review')).toBe('Pending review')
    expect(formatStatusLabel('out-for-delivery')).toBe('Out for delivery')
  })
})
