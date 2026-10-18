import { describe, expect, test } from 'vitest'
import { toCsv } from './csv.ts'

describe('toCsv', () => {
  test('quotes every cell, ends lines with CRLF, and starts with a byte order mark', () => {
    expect(
      toCsv([
        ['Row', 'Problem'],
        ['2', 'Title "Jute Bag, Large" is fine\nbut long'],
      ]).toString('utf8'),
    ).toBe(
      '\ufeff"Row","Problem"\r\n"2","Title ""Jute Bag, Large"" is fine\nbut long"\r\n',
    )
  })

  test('makes a cell that starts like a formula show as text', () => {
    const cells = [
      '=HYPERLINK("http://evil.test")',
      '+91 98000 00000',
      '-5',
      '@SUM(A1)',
      '\t=1+1',
      '\r=1+1',
      '₹1,299',
    ]
    expect(toCsv([cells]).toString('utf8')).toBe(
      '\ufeff"\'=HYPERLINK(""http://evil.test"")","\'+91 98000 00000","\'-5","\'@SUM(A1)","\'\t=1+1","\'\r=1+1","₹1,299"\r\n',
    )
  })
})
