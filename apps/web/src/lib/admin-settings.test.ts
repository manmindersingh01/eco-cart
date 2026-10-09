import { describe, expect, test } from 'vitest'
import {
  basisPointsToPercentInput,
  issuesFor,
  paiseToRupeeInput,
  parsePercentToBasisPoints,
  parseRupeesToPaise,
  parseWholeNumber,
  sourcePresentation,
} from './admin-settings'

describe('settings decimal conversions', () => {
  test('converts rupees to paise without floating-point rounding', () => {
    expect(parseRupeesToPaise('49')).toEqual({ ok: true, value: 4900 })
    expect(parseRupeesToPaise('49.90')).toEqual({ ok: true, value: 4990 })
    expect(parseRupeesToPaise('0.01')).toEqual({ ok: true, value: 1 })
    expect(paiseToRupeeInput(4990)).toBe('49.90')
  })

  test('rejects malformed money before it reaches the API', () => {
    expect(parseRupeesToPaise('-1').ok).toBe(false)
    expect(parseRupeesToPaise('1.001').ok).toBe(false)
    expect(parseRupeesToPaise('₹49').ok).toBe(false)
    expect(parseRupeesToPaise('1e3').ok).toBe(false)
  })

  test('converts percentages to basis points at their boundaries', () => {
    expect(parsePercentToBasisPoints('0')).toEqual({ ok: true, value: 0 })
    expect(parsePercentToBasisPoints('0.25')).toEqual({ ok: true, value: 25 })
    expect(parsePercentToBasisPoints('10')).toEqual({ ok: true, value: 1000 })
    expect(parsePercentToBasisPoints('100.00')).toEqual({
      ok: true,
      value: 10_000,
    })
    expect(parsePercentToBasisPoints('100.01')).toEqual({
      ok: true,
      value: 10_001,
    })
    expect(basisPointsToPercentInput(1050)).toBe('10.5')
  })

  test('accepts only non-negative whole numbers for limits', () => {
    expect(parseWholeNumber('0', 'Limit')).toEqual({ ok: true, value: 0 })
    expect(parseWholeNumber('120', 'Limit')).toEqual({
      ok: true,
      value: 120,
    })
    expect(parseWholeNumber('1.5', 'Limit').ok).toBe(false)
    expect(parseWholeNumber('-1', 'Limit').ok).toBe(false)
  })
})

describe('settings presentation', () => {
  test('distinguishes saved, default, and missing sources', () => {
    expect(sourcePresentation('saved')).toMatchObject({
      label: 'Saved value',
      tone: 'success',
    })
    expect(sourcePresentation('default')).toMatchObject({
      label: 'Using default',
      tone: 'neutral',
    })
    expect(sourcePresentation('missing')).toMatchObject({
      label: 'Setup required',
      tone: 'warning',
    })
  })

  test('associates backend issues with their company field', () => {
    const issues = [
      'gstin must contain the PAN as its 3rd to 12th characters',
      'address.stateCode must be a two-digit GST state code, like 27',
    ]
    expect(issuesFor(issues, 'gstin')).toEqual([
      'must contain the PAN as its 3rd to 12th characters',
    ])
    expect(issuesFor(issues, 'address.stateCode')).toEqual([
      'must be a two-digit GST state code, like 27',
    ])
  })
})
