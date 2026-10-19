import { describe, expect, test } from 'vitest'
import { amountInWords, numberInWords } from './words.ts'

describe('numberInWords', () => {
  test('uses thousand, lakh, and crore', () => {
    expect(numberInWords(0)).toBe('Zero')
    expect(numberInWords(11)).toBe('Eleven')
    expect(numberInWords(40)).toBe('Forty')
    expect(numberInWords(727)).toBe('Seven Hundred Twenty-Seven')
    expect(numberInWords(1_911)).toBe('One Thousand Nine Hundred Eleven')
    expect(numberInWords(1_00_000)).toBe('One Lakh')
    expect(numberInWords(1_02_000)).toBe('One Lakh Two Thousand')
    expect(numberInWords(1_23_45_678)).toBe(
      'One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight',
    )
  })

  test('counts crores past ninety-nine', () => {
    expect(numberInWords(100_00_00_000)).toBe('One Hundred Crore')
  })

  test('refuses what is not a whole number of at least 0', () => {
    expect(() => numberInWords(-1)).toThrow('Cannot write -1 in words')
    expect(() => numberInWords(1.5)).toThrow('Cannot write 1.5 in words')
  })
})

describe('amountInWords', () => {
  test('writes rupees and paise', () => {
    expect(amountInWords(72_700)).toBe('Rupees Seven Hundred Twenty-Seven Only')
    expect(amountInWords(1_02_000_50)).toBe(
      'Rupees One Lakh Two Thousand and Fifty Paise Only',
    )
    expect(amountInWords(50)).toBe('Rupees Zero and Fifty Paise Only')
    expect(amountInWords(0)).toBe('Rupees Zero Only')
  })

  test('refuses what is not whole paise', () => {
    expect(() => amountInWords(10.5)).toThrow(
      'Cannot write 10.5 paise in words',
    )
    expect(() => amountInWords(-100)).toThrow(
      'Cannot write -100 paise in words',
    )
  })
})
