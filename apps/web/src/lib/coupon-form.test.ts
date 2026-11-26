import { describe, expect, test } from 'vitest'
import {
  couponPayload,
  couponValues,
  emptyCoupon,
  indiaDateTime,
  type CouponData,
} from './coupon-form'

const saved: CouponData = {
  id: 'coupon-id',
  code: 'SAVE25',
  description: 'Saved',
  discountType: 'percent',
  discountValue: 2550,
  minOrderPaise: 10025,
  maxDiscountPaise: 5075,
  usageLimit: 5,
  perUserLimit: 2,
  usedCount: 0,
  startsAt: '2026-11-27T20:40:31.456Z',
  endsAt: '2026-12-31T18:00:12.789Z',
  isActive: true,
  createdBy: 'admin',
  createdAt: '2026-11-27T00:00:00Z',
  updatedAt: '2026-11-27T00:00:00Z',
}

describe('coupon form conversions', () => {
  test('sends exact integer paise and basis points', () => {
    expect(
      couponPayload({
        ...emptyCoupon,
        code: 'save25',
        discount: '25.50',
        minimum: '100.25',
        cap: '50.75',
        start: '2026-12-01T00:15',
        end: '2026-12-31T23:59',
      }),
    ).toEqual({
      ok: true,
      value: {
        code: 'SAVE25',
        description: '',
        discountType: 'percent',
        discountValue: 2550,
        minOrderPaise: 10025,
        maxDiscountPaise: 5075,
        usageLimit: null,
        perUserLimit: null,
        isActive: true,
        startsAt: '2026-11-30T18:45:00.000Z',
        endsAt: '2026-12-31T18:29:00.000Z',
      },
    })
  })
  test('preserves unchanged timestamps, code and enable flag when editing terms', () => {
    expect(indiaDateTime(saved.startsAt)).toBe('2026-11-28T02:10')
    expect(
      couponPayload({ ...couponValues(saved), description: 'Changed' }, saved),
    ).toEqual({ ok: true, value: { description: 'Changed' } })
  })
  test('clears the percentage cap when changing to a fixed discount', () => {
    expect(
      couponPayload(
        { ...couponValues(saved), discountType: 'fixed', discount: '10.05' },
        saved,
      ),
    ).toEqual({
      ok: true,
      value: {
        discountType: 'fixed',
        discountValue: 1005,
        maxDiscountPaise: null,
      },
    })
  })
  test('keeps the discount unit and cap with a changed value', () => {
    expect(
      couponPayload({ ...couponValues(saved), discount: '20' }, saved),
    ).toEqual({
      ok: true,
      value: {
        discountType: 'percent',
        discountValue: 2000,
        maxDiscountPaise: 5075,
      },
    })
  })
  test('clears an end date explicitly and rejects impossible calendar dates', () => {
    expect(couponPayload({ ...couponValues(saved), end: '' }, saved)).toEqual({
      ok: true,
      value: { endsAt: null },
    })
    expect(
      couponPayload({
        ...emptyCoupon,
        code: 'SAVE',
        discount: '10',
        start: '2026-02-30T12:00',
      }).ok,
    ).toBe(false)
  })
  test('rejects decimal rounding, unsafe values and an empty edit', () => {
    for (const discount of ['1.005', '1e2', '9007199254740992'])
      expect(couponPayload({ ...emptyCoupon, code: 'SAVE', discount }).ok).toBe(
        false,
      )
    expect(couponPayload(couponValues(saved), saved)).toEqual({
      ok: false,
      error: 'There are no changes to save.',
    })
  })
})
