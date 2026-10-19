import { describe, expect, test } from 'vitest'
import { formatRupees, plainRupees } from './money.ts'

describe('money', () => {
  test('formatRupees groups rupees the Indian way', () => {
    expect(formatRupees(10_000_000)).toBe('₹1,00,000')
    expect(formatRupees(10_200_050)).toBe('₹1,02,000.50')
    expect(formatRupees(-12_345)).toBe('-₹123.45')
  })

  test('plainRupees writes a number spreadsheets add up', () => {
    expect(plainRupees(123_450)).toBe('1234.50')
    expect(plainRupees(100_000_000_00)).toBe('100000000.00')
    expect(plainRupees(7)).toBe('0.07')
    expect(plainRupees(0)).toBe('0.00')
    expect(plainRupees(-5)).toBe('-0.05')
    expect(plainRupees(-1_299_00)).toBe('-1299.00')
  })
})
