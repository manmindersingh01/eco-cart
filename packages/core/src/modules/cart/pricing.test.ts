import { describe, expect, test } from 'vitest'
import {
  backCalculateTax,
  couponDiscount,
  deliveryCharge,
  splitDiscount,
} from './pricing.ts'

describe('couponDiscount', () => {
  const tenPercent = {
    discountType: 'percent' as const,
    discountValue: 1_000,
    maxDiscountPaise: null,
  }

  test('takes a percentage, rounded down to the paisa', () => {
    expect(couponDiscount(tenPercent, 129_900)).toBe(12_990)
    expect(couponDiscount(tenPercent, 999)).toBe(99)
  })

  test('stops at the maximum discount', () => {
    expect(
      couponDiscount({ ...tenPercent, maxDiscountPaise: 10_000 }, 500_000),
    ).toBe(10_000)
  })

  test('takes a fixed amount, never more than the items', () => {
    const fixed = {
      discountType: 'fixed' as const,
      discountValue: 20_000,
      maxDiscountPaise: null,
    }
    expect(couponDiscount(fixed, 59_900)).toBe(20_000)
    expect(couponDiscount(fixed, 15_000)).toBe(15_000)
    expect(
      couponDiscount({ ...tenPercent, discountValue: 10_000 }, 4_200),
    ).toBe(4_200)
  })
})

describe('deliveryCharge', () => {
  const rules = { chargePaise: 4_900, freeFromPaise: 49_900 }

  test('charges below the threshold and is free from it', () => {
    expect(deliveryCharge(49_899, rules)).toBe(4_900)
    expect(deliveryCharge(49_900, rules)).toBe(0)
  })

  test('charges nothing for nothing', () => {
    expect(deliveryCharge(0, rules)).toBe(0)
  })
})

describe('splitDiscount', () => {
  test('splits in proportion and always adds up to the discount', () => {
    expect(splitDiscount([50_000, 30_000, 20_000], 10_000)).toEqual([
      5_000, 3_000, 2_000,
    ])
    const shares = splitDiscount([33_333, 33_333, 33_334], 10_001)
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(10_001)
    expect(shares).toEqual([3_334, 3_333, 3_334])
  })

  test('gives left-over paise to the largest remainders, earlier lines first', () => {
    expect(splitDiscount([100, 100, 100], 2)).toEqual([1, 1, 0])
    expect(splitDiscount([1, 1], 1)).toEqual([1, 0])
  })

  test('gives no share without a discount', () => {
    expect(splitDiscount([50_000, 20_000], 0)).toEqual([0, 0])
  })

  test('never gives a line more than its total', () => {
    const lines = [1, 999, 5_000]
    const shares = splitDiscount(lines, 6_000)
    expect(shares).toEqual(lines)
  })

  test('refuses a discount larger than the lines', () => {
    expect(() => splitDiscount([100], 101)).toThrow(
      'A discount cannot be larger than the lines it is split over',
    )
  })
})

describe('backCalculateTax', () => {
  test('splits a tax-inclusive amount into taxable value and tax', () => {
    expect(backCalculateTax(50_000, 1_800)).toEqual({
      taxablePaise: 42_373,
      taxPaise: 7_627,
    })
    expect(backCalculateTax(10_500, 500)).toEqual({
      taxablePaise: 10_000,
      taxPaise: 500,
    })
    expect(backCalculateTax(9_999, 0)).toEqual({
      taxablePaise: 9_999,
      taxPaise: 0,
    })
  })
})
