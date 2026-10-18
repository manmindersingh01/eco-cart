import { createHash } from 'node:crypto'
import { crc32 } from 'node:zlib'
import sharp from 'sharp'
import { describe, expect, test } from 'vitest'
import { testPdf } from '../testing/files.ts'
import { checkDocumentFile, DocumentRejectedError } from './document-files.ts'

/** A solid-colour photo of a document, with optional EXIF data. */
const photo = (
  format: 'jpeg' | 'png' | 'gif' | 'webp',
  options: {
    exif?: Record<string, Record<string, string>>
    orientation?: number
  } = {},
) => {
  let image = sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: { r: 240, g: 240, b: 230 },
    },
  })
  if (options.exif) image = image.withExif(options.exif)
  if (options.orientation) {
    image = image.withMetadata({ orientation: options.orientation })
  }
  return image.toFormat(format).toBuffer()
}

async function reasonFor(bytes: Buffer): Promise<string> {
  const error = await checkDocumentFile(bytes).then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof DocumentRejectedError)) {
    throw new Error(`Expected the file to be refused, got ${String(error)}`)
  }
  return error.message
}

/** One PNG chunk: length, type, data, and checksum. */
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** A PNG that claims `width` x `height` pixels but holds no pixel data. */
function pngClaiming(width: number, height: number): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', Buffer.alloc(0)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const sha256 = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex')

describe('checkDocumentFile', () => {
  test('keeps a readable PDF exactly as uploaded', async () => {
    const pdf = testPdf()
    const checked = await checkDocumentFile(pdf)
    expect(checked.contentType).toBe('application/pdf')
    expect(checked.bytes.equals(pdf)).toBe(true)
    expect(checked.contentHash).toBe(sha256(pdf))
  })

  test('re-encodes a JPEG upright and without its metadata', async () => {
    const original = await photo('jpeg', {
      exif: { IFD0: { Make: 'PhoneCo', Copyright: 'Green Basket' } },
      orientation: 6,
    })
    const before = await sharp(original).metadata()
    expect(before.exif).toBeDefined()
    expect(before.orientation).toBe(6)

    const checked = await checkDocumentFile(original)
    expect(checked.contentType).toBe('image/jpeg')
    const after = await sharp(checked.bytes).metadata()
    expect(after.format).toBe('jpeg')
    expect(after.exif).toBeUndefined()
    expect(after.orientation).toBeUndefined()
    // Turned the way the phone held it.
    expect([after.width, after.height]).toEqual([600, 800])
    expect(checked.contentHash).toBe(sha256(checked.bytes))
  })

  test('re-encodes a PNG as a PNG', async () => {
    const checked = await checkDocumentFile(await photo('png'))
    expect(checked.contentType).toBe('image/png')
    expect((await sharp(checked.bytes).metadata()).format).toBe('png')
  })

  test('goes by the bytes, not the name or the claimed type', async () => {
    expect(await reasonFor(Buffer.from('GST certificate, honest'))).toBe(
      'The file is not a PDF, JPEG, or PNG',
    )
    expect(await reasonFor(await photo('gif'))).toBe(
      'The file is not a PDF, JPEG, or PNG',
    )
    expect(await reasonFor(await photo('webp'))).toBe(
      'The file is not a PDF, JPEG, or PNG',
    )
    expect(await reasonFor(Buffer.alloc(0))).toBe(
      'The file is not a PDF, JPEG, or PNG',
    )
  })

  test('refuses a PDF that needs a password', async () => {
    expect(await reasonFor(testPdf({ locked: true }))).toBe(
      'The PDF is protected with a password; upload a copy without one',
    )
  })

  test('refuses a damaged PDF', async () => {
    expect(
      await reasonFor(Buffer.from('%PDF-1.7\nthe rest went missing', 'latin1')),
    ).toBe('The PDF is damaged and cannot be opened')
  })

  test('refuses a damaged image', async () => {
    const jpeg = await photo('jpeg')
    expect(await reasonFor(jpeg.subarray(0, 20))).toBe(
      'The image is damaged and cannot be read',
    )
    expect(
      await reasonFor(
        Buffer.concat([jpeg.subarray(0, jpeg.length / 2), Buffer.alloc(64)]),
      ),
    ).toBe('The image is damaged and cannot be read')
  })

  test('refuses an image that claims more than 50 megapixels without decoding it', async () => {
    expect(await reasonFor(pngClaiming(10_000, 10_000))).toBe(
      'The image is too large; it can have at most 50 megapixels',
    )
  })
})
