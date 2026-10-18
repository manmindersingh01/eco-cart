import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { getResolvedPDFJS } from 'unpdf'
import { MAX_IMAGE_PIXELS } from './images.ts'

/*
 * Checks a file a seller uploaded to verify their business (design doc 5.4).
 * Runs only in the worker, because it loads the image and PDF libraries.
 * The type comes from the bytes, never from what the browser claimed.
 * Photos are re-encoded, which drops everything but the pixels, including
 * any location a phone wrote into them. PDFs are opened to prove they are
 * whole and readable without a password; they are kept as uploaded, and
 * administrators only ever download them as attachments.
 */

/** A file that cannot be used; the message is shown to the seller. */
export class DocumentRejectedError extends Error {
  override name = 'DocumentRejectedError'
}

export type CheckedContentType = 'application/pdf' | 'image/jpeg' | 'image/png'

export interface CheckedDocument {
  contentType: CheckedContentType
  /** What to store: the re-encoded photo, or the PDF as uploaded. */
  bytes: Buffer
  /** SHA-256 of `bytes`, in hex. */
  contentHash: string
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])

function typeOf(bytes: Buffer): CheckedContentType | null {
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') {
    return 'application/pdf'
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png'
  return null
}

const isPasswordError = (error: unknown) =>
  error instanceof Error && error.name === 'PasswordException'

async function checkPdf(bytes: Buffer): Promise<void> {
  const { getDocument } = await getResolvedPDFJS()
  // The library takes over the array it is given, so it gets a copy.
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 })
  let pages: number
  try {
    pages = (await task.promise).numPages
  } catch (error) {
    if (isPasswordError(error)) {
      throw new DocumentRejectedError(
        'The PDF is protected with a password; upload a copy without one',
      )
    }
    throw new DocumentRejectedError('The PDF is damaged and cannot be opened')
  } finally {
    await task.destroy()
  }
  if (pages < 1) throw new DocumentRejectedError('The PDF has no pages')
}

async function reencodeImage(
  bytes: Buffer,
  contentType: 'image/jpeg' | 'image/png',
): Promise<Buffer> {
  let width: number
  let height: number
  try {
    // Reading the header decodes no pixels, so it needs no pixel limit.
    ;({ width, height } = (await sharp(bytes).metadata()).autoOrient)
  } catch {
    throw new DocumentRejectedError('The image is damaged and cannot be read')
  }
  if (width * height > MAX_IMAGE_PIXELS) {
    throw new DocumentRejectedError(
      `The image is too large; it can have at most ${MAX_IMAGE_PIXELS / 1_000_000} megapixels`,
    )
  }
  try {
    const image = sharp(bytes, {
      autoOrient: true,
      limitInputPixels: MAX_IMAGE_PIXELS,
    })
    return await (
      contentType === 'image/jpeg' ? image.jpeg({ quality: 90 }) : image.png()
    ).toBuffer()
  } catch {
    // Damaged pixel data only shows up once the image is decoded.
    throw new DocumentRejectedError('The image is damaged and cannot be read')
  }
}

/**
 * Checks an uploaded verification document and returns what to store.
 * Throws DocumentRejectedError with a plain reason for a file that cannot be
 * used.
 */
export async function checkDocumentFile(
  bytes: Buffer,
): Promise<CheckedDocument> {
  const contentType = typeOf(bytes)
  if (!contentType) {
    throw new DocumentRejectedError('The file is not a PDF, JPEG, or PNG')
  }
  let stored: Buffer
  if (contentType === 'application/pdf') {
    await checkPdf(bytes)
    stored = bytes
  } else {
    stored = await reencodeImage(bytes, contentType)
  }
  return {
    contentType,
    bytes: stored,
    contentHash: createHash('sha256').update(stored).digest('hex'),
  }
}
