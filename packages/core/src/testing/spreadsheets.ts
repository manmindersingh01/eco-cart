import { strToU8, zipSync } from 'fflate'

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const RELATIONSHIPS =
  'http://schemas.openxmlformats.org/package/2006/relationships'
const OFFICE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

const escapeXml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

const columnName = (index: number): string =>
  index < 26
    ? String.fromCharCode(65 + index)
    : columnName(Math.floor(index / 26) - 1) + columnName(index % 26)

/**
 * A one-sheet Excel workbook, written the way Excel stores cells: text as
 * text and numbers as numbers. A null cell is left out, and an empty row is
 * left out of the sheet, as Excel does.
 */
export function createTestWorkbook(
  rows: (string | number | null)[][],
): Buffer<ArrayBuffer> {
  const sheetRows = rows
    .map((cells, rowIndex) => {
      const row = rowIndex + 1
      const xml = cells
        .map((value, column) => {
          const ref = `${columnName(column)}${row}`
          if (value === null) return ''
          return typeof value === 'number'
            ? `<c r="${ref}"><v>${value}</v></c>`
            : `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`
        })
        .join('')
      return xml ? `<row r="${row}">${xml}</row>` : ''
    })
    .join('')
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${RELATIONSHIPS}"><Relationship Id="rId1" Type="${OFFICE}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${MAIN}" xmlns:r="${OFFICE}"><sheets><sheet name="Products" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${RELATIONSHIPS}"><Relationship Id="rId1" Type="${OFFICE}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${MAIN}"><sheetData>${sheetRows}</sheetData></worksheet>`,
  }
  return Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([name, xml]) => [name, strToU8(xml)]),
      ),
    ),
  )
}
