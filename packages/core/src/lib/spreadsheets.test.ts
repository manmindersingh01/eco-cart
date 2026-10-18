import { strToU8, zipSync } from 'fflate'
import { describe, expect, test } from 'vitest'
import { createTestWorkbook } from '../testing/spreadsheets.ts'
import {
  readSpreadsheet,
  SpreadsheetRejectedError,
  type SpreadsheetType,
} from './spreadsheets.ts'

const limits = { maxRows: 5, maxColumns: 4 }
const read = (bytes: Buffer, type: SpreadsheetType = 'csv') =>
  readSpreadsheet(bytes, type, limits)
const csv = (text: string) => Buffer.from(text, 'utf8')

async function rejection(attempt: Promise<unknown>): Promise<string> {
  const error = await attempt.then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof SpreadsheetRejectedError)) {
    throw new Error(`Expected a SpreadsheetRejectedError, got ${String(error)}`)
  }
  return error.message
}

describe('reading a CSV file', () => {
  test('keeps text exactly, with spreadsheet row numbers, and skips empty rows', async () => {
    expect(
      await read(
        csv(
          '\ufeffTitle,Price,Notes\r\n"Jute Bag, Large", " 1,299.50 ","Says ""hello""\nover two lines"\r\n\r\n,,\r\nBamboo Straw,50\r\n',
        ),
      ),
    ).toEqual({
      headers: ['Title', 'Price', 'Notes'],
      rows: [
        {
          rowNumber: 2,
          values: [
            'Jute Bag, Large',
            '1,299.50',
            'Says "hello"\nover two lines',
          ],
        },
        { rowNumber: 5, values: ['Bamboo Straw', '50', ''] },
      ],
    })
  })

  test('names blank headings and numbers repeated ones', async () => {
    const sheet = await read(csv('Title,,title,Title\nA,B,C,D\n'))
    expect(sheet.headers).toEqual([
      'Title',
      'Column 2',
      'title (2)',
      'Title (3)',
    ])
  })

  test('starts at the first row with something in it', async () => {
    const sheet = await read(csv('\n\nTitle\nJute Bag\n'))
    expect(sheet).toEqual({
      headers: ['Title'],
      rows: [{ rowNumber: 4, values: ['Jute Bag'] }],
    })
  })

  test('refuses what it cannot import, saying why', async () => {
    expect(await rejection(read(Buffer.from([0xff, 0xfe, 0x54, 0x00])))).toBe(
      'The file is not UTF-8 text; in Excel, save it as "CSV UTF-8 (Comma delimited)" and upload it again',
    )
    expect(await rejection(read(csv('Title\n"Jute Bag\n')))).toBe(
      'The file is not valid CSV near line 2; check that every quote is closed',
    )
    expect(await rejection(read(csv('')))).toBe('The file is empty')
    expect(await rejection(read(csv('Title,Price\n')))).toBe(
      'The file has a header row but no products below it',
    )
    expect(await rejection(read(csv('A,B,C,D,E\n1,2,3,4,5\n')))).toBe(
      'The file has 5 columns; it can have at most 4',
    )
    expect(await rejection(read(csv(`Title\n${'Jute Bag\n'.repeat(6)}`)))).toBe(
      'The file has more than 5 rows; split it into smaller files',
    )
  })
})

describe('reading an Excel workbook', () => {
  test('keeps numbers as the digits the file stores, with Excel row numbers', async () => {
    const book = createTestWorkbook([
      [],
      ['Title', 'Price', 'Stock'],
      ['Jute Bag', 1299.5, 40],
      [],
      ['Bamboo Straw', 19.99, null],
    ])
    expect(await read(book, 'xlsx')).toEqual({
      headers: ['Title', 'Price', 'Stock'],
      rows: [
        { rowNumber: 3, values: ['Jute Bag', '1299.5', '40'] },
        { rowNumber: 5, values: ['Bamboo Straw', '19.99', ''] },
      ],
    })
  })

  test('refuses an old .xls workbook, a file that is not a workbook, and one that unpacks too large', async () => {
    // Excel 97-2003 files start with the OLE2 signature.
    const xls = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(504),
    ])
    expect(await rejection(read(xls, 'xlsx'))).toBe(
      'The file is an old Excel 97-2003 workbook (.xls); save it as .xlsx or CSV and upload it again',
    )
    expect(await rejection(read(csv('Title\nJute Bag\n'), 'xlsx'))).toBe(
      'The file is not a readable Excel workbook (.xlsx)',
    )
    // 60 MB of spaces packs into a few kilobytes.
    const bomb = Buffer.from(
      zipSync({
        'xl/worksheets/sheet1.xml': strToU8(' '.repeat(60 * 1024 * 1024)),
      }),
    )
    expect(bomb.length).toBeLessThan(200_000)
    expect(await rejection(read(bomb, 'xlsx'))).toBe(
      'The file is not a readable Excel workbook (.xlsx)',
    )
  })
})
