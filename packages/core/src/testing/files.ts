/*
 * Small files for upload tests, written byte by byte so a test controls
 * exactly what the worker receives.
 */

/**
 * A one-page PDF. With `locked`, it needs a password to open: its
 * encryption entry holds a check value no password matches.
 */
export function testPdf({
  locked = false,
  size,
}: { locked?: boolean; size?: number } = {}): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>',
    ...(locked
      ? [
          `<< /Filter /Standard /V 1 /R 2 /O <${'ab'.repeat(32)}> /U <${'cd'.repeat(32)}> /P -44 >>`,
        ]
      : []),
  ]
  // A legal comment before the trailer pads boundary files without moving
  // the objects or cross-reference table.
  const padding = size === undefined ? 0 : size - testPdf({ locked }).length
  if (padding < 2) {
    if (size !== undefined)
      throw new Error('PDF size must allow a padding comment')
  }
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  const encryption = locked
    ? ` /Encrypt 4 0 R /ID [<${'01'.repeat(16)}> <${'01'.repeat(16)}>]`
    : ''
  if (size !== undefined) pdf += `%${' '.repeat(padding - 2)}\n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encryption} >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}
