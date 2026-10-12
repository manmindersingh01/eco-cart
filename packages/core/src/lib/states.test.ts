import { describe, expect, test } from 'vitest'
import { GST_STATES, isGstStateCode, stateName } from './states.ts'
import { parseInput, stateCode } from './validation.ts'

describe('GST state codes', () => {
  test('lists the 28 states and 8 union territories once each, in code order', () => {
    const codes = GST_STATES.map((state) => state.code)
    expect(codes).toHaveLength(36)
    expect(new Set(codes).size).toBe(36)
    expect(new Set(GST_STATES.map((state) => state.name)).size).toBe(36)
    expect(codes).toEqual(codes.toSorted())
    for (const code of codes) expect(code).toMatch(/^\d{2}$/)
  })

  test('names a code', () => {
    expect(stateName('27')).toBe('Maharashtra')
    expect(stateName('29')).toBe('Karnataka')
    expect(stateName('26')).toBe('Dadra and Nagar Haveli and Daman and Diu')
    expect(stateName('37')).toBe('Andhra Pradesh')
    expect(stateName('38')).toBe('Ladakh')
    expect(stateName('99')).toBeUndefined()
  })

  test.each(['00', '25', '28', '39', '97', '99', '7', '027', ''])(
    'refuses %j',
    (code) => {
      expect(isGstStateCode(code)).toBe(false)
      expect(() => parseInput(stateCode, code, 'Not valid')).toThrow(
        'Not valid',
      )
    },
  )

  test('accepts every listed code', () => {
    for (const { code } of GST_STATES) {
      expect(parseInput(stateCode, code, 'Not valid')).toBe(code)
    }
  })
})
