import { createHash } from 'node:crypto'
import { crc32 } from 'node:zlib'
import sharp from 'sharp'
import { describe, expect, test } from 'vitest'
import { ImageRejectedError, prepareProductImage } from './image-processing.ts'

/** A solid-colour photo, with optional EXIF data. */
const photo = (
  width: number,
  height: number,
  format: 'jpeg' | 'png' | 'webp' | 'avif' | 'gif' = 'jpeg',
  exif?: Record<string, Record<string, string>>,
) => {
  const image = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 40, g: 140, b: 70 },
    },
  })
  return (exif ? image.withExif(exif) : image).toFormat(format).toBuffer()
}

async function reasonFor(bytes: Buffer): Promise<string> {
  const error = await prepareProductImage(bytes).then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof ImageRejectedError)) {
    throw new Error(`Expected the photo to be refused, got ${String(error)}`)
  }
  return error.message
}

/** One PNG chunk: length, type, data, and checksum. */
function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/**
 * A PNG whose header claims `width` x `height` pixels but holds almost no
 * data, the shape of a decompression bomb.
 */
function pngClaiming(width: number, height: number): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8) // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', Buffer.alloc(0)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

describe('prepareProductImage', () => {
  test('makes three WebP sizes and drops every bit of metadata', async () => {
    const original = await photo(1600, 1200, 'jpeg', {
      IFD0: { Copyright: 'Green Basket', Make: 'PhoneCo' },
    })
    expect((await sharp(original).metadata()).exif).toBeDefined()

    const prepared = await prepareProductImage(original)

    expect(prepared).toMatchObject({
      width: 1600,
      height: 1200,
      contentType: 'image/jpeg',
      contentHash: createHash('sha256').update(original).digest('hex'),
    })
    const sizes = await Promise.all(
      Object.values(prepared.sizes).map((bytes) => sharp(bytes).metadata()),
    )
    expect(
      sizes.map(({ format, width, height }) => ({ format, width, height })),
    ).toEqual([
      { format: 'webp', width: 160, height: 120 },
      { format: 'webp', width: 480, height: 360 },
      { format: 'webp', width: 1200, height: 900 },
    ])
    for (const size of sizes) expect(size.exif).toBeUndefined()
  })

  test('turns a sideways phone photo upright', async () => {
    // Stored 1200 x 800 with "rotate 90°" in EXIF, as phones often do.
    const original = await sharp(await photo(1200, 800))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer()

    const prepared = await prepareProductImage(original)

    expect([prepared.width, prepared.height]).toEqual([800, 1200])
    const gallery = await sharp(prepared.sizes.gallery).metadata()
    expect([gallery.width, gallery.height, gallery.orientation]).toEqual([
      800,
      1200,
      undefined,
    ])
  })

  test('never enlarges a photo smaller than a size', async () => {
    const prepared = await prepareProductImage(await photo(700, 700, 'png'))
    const gallery = await sharp(prepared.sizes.gallery).metadata()
    expect([gallery.width, gallery.height]).toEqual([700, 700])
  })

  test.each([
    ['png', 'image/png'],
    ['webp', 'image/webp'],
    ['avif', 'image/avif'],
  ] as const)('accepts %s', async (format, contentType) => {
    const prepared = await prepareProductImage(await photo(800, 600, format))
    expect(prepared.contentType).toBe(contentType)
  })

  test('refuses a photo smaller than 600 pixels on its longer side', async () => {
    expect(await reasonFor(await photo(599, 400))).toBe(
      'The image is too small; it needs at least 600 pixels on its longer side',
    )
  })

  test('refuses other kinds of file, whatever they claim to be', async () => {
    const notAnImage = 'The file is not a JPEG, PNG, WebP, or AVIF image'
    expect(await reasonFor(Buffer.from('%PDF-1.7 not a photo'))).toBe(
      notAnImage,
    )
    expect(await reasonFor(await photo(800, 600, 'gif'))).toBe(notAnImage)
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><script>alert(1)</script></svg>',
    )
    expect(await reasonFor(svg)).toBe(notAnImage)
  })

  test('refuses a damaged photo', async () => {
    const whole = await photo(1600, 1200)
    expect(await reasonFor(whole.subarray(0, whole.length / 2))).toBe(
      'The file is damaged and cannot be read',
    )
  })

  test('refuses a file that claims more than 50 megapixels without decoding it', async () => {
    expect(await reasonFor(pngClaiming(10_000, 10_000))).toBe(
      'The image is too large; it can have at most 50 megapixels',
    )
  })
})
