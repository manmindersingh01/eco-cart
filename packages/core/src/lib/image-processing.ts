import { createHash } from 'node:crypto'
import sharp, { type Metadata, type Sharp } from 'sharp'
import {
  IMAGE_SIZES,
  MAX_IMAGE_PIXELS,
  MIN_IMAGE_SIDE,
  type ImageContentType,
  type ImageSize,
} from './images.ts'

/*
 * Turns an uploaded photo into the fixed sizes the storefront shows (design
 * doc section 7: pre-sized images, no resizing on the fly), and checks
 * buyers' return photos. Runs only in the worker. Every photo is re-encoded,
 * which also drops all metadata, including any GPS location a phone wrote
 * into the photo.
 */

/** A photo that cannot be used; the message is shown to whoever sent it. */
export class ImageRejectedError extends Error {
  override name = 'ImageRejectedError'
}

export interface PreparedImage {
  /** Upright dimensions of the original. */
  width: number
  height: number
  /** SHA-256 of the uploaded bytes, in hex. */
  contentHash: string
  /** The type the bytes really are, whatever the browser claimed. */
  contentType: ImageContentType
  sizes: Record<ImageSize, Buffer>
}

const NOT_AN_IMAGE = 'The file is not a JPEG, PNG, WebP, or AVIF image'

async function detectType(image: Sharp): Promise<{
  contentType: ImageContentType
  width: number
  height: number
}> {
  let metadata: Metadata
  try {
    metadata = await image.metadata()
  } catch {
    throw new ImageRejectedError(NOT_AN_IMAGE)
  }
  const contentType =
    metadata.format === 'jpeg'
      ? 'image/jpeg'
      : metadata.format === 'png'
        ? 'image/png'
        : metadata.format === 'webp'
          ? 'image/webp'
          : // AVIF and HEIC share one container; only AVIF can be decoded.
            metadata.format === 'heif' && metadata.compression === 'av1'
            ? 'image/avif'
            : null
  if (!contentType) throw new ImageRejectedError(NOT_AN_IMAGE)
  return { contentType, ...metadata.autoOrient }
}

/**
 * Checks an uploaded photo and makes every size. Throws ImageRejectedError
 * with a plain reason for a file that cannot be used.
 */
export async function prepareProductImage(
  bytes: Buffer,
): Promise<PreparedImage> {
  const open = () =>
    sharp(bytes, { autoOrient: true, limitInputPixels: MAX_IMAGE_PIXELS })
  // Reading the header decodes no pixels, so it needs no pixel limit; the
  // limit guards the decoding below, after the size check.
  const { contentType, width, height } = await detectType(sharp(bytes))
  if (width * height > MAX_IMAGE_PIXELS) {
    throw new ImageRejectedError(
      `The image is too large; it can have at most ${MAX_IMAGE_PIXELS / 1_000_000} megapixels`,
    )
  }
  if (Math.max(width, height) < MIN_IMAGE_SIDE) {
    throw new ImageRejectedError(
      `The image is too small; it needs at least ${MIN_IMAGE_SIDE} pixels on its longer side`,
    )
  }

  const resize = async (side: number) => {
    try {
      return await open()
        .resize({
          width: side,
          height: side,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toBuffer()
    } catch {
      // Damaged pixel data only shows up once the image is decoded.
      throw new ImageRejectedError('The file is damaged and cannot be read')
    }
  }
  const [thumb, card, gallery] = await Promise.all([
    resize(IMAGE_SIZES.thumb),
    resize(IMAGE_SIZES.card),
    resize(IMAGE_SIZES.gallery),
  ])
  return {
    width,
    height,
    contentHash: createHash('sha256').update(bytes).digest('hex'),
    contentType,
    sizes: { thumb, card, gallery },
  }
}

/** Return photos are kept at most this many pixels on their longer side. */
export const RETURN_PHOTO_MAX_SIDE = 2000
const RETURN_PHOTO_MIN_SIDE = 320

export interface PreparedReturnPhoto {
  /** The photo to store: upright, without metadata, as a JPEG. */
  bytes: Buffer
  /** Dimensions of `bytes`. */
  width: number
  height: number
  /** SHA-256 of `bytes`, in hex. */
  contentHash: string
}

/**
 * Checks a buyer's return photo (design doc 5.7) and re-encodes it as one
 * JPEG that administrators and the seller can open anywhere. Throws
 * ImageRejectedError with a plain reason for a file that cannot be used.
 */
export async function prepareReturnPhoto(
  bytes: Buffer,
): Promise<PreparedReturnPhoto> {
  const { width, height } = await detectType(sharp(bytes))
  if (width * height > MAX_IMAGE_PIXELS) {
    throw new ImageRejectedError(
      `The image is too large; it can have at most ${MAX_IMAGE_PIXELS / 1_000_000} megapixels`,
    )
  }
  if (Math.max(width, height) < RETURN_PHOTO_MIN_SIDE) {
    throw new ImageRejectedError(
      `The photo is too small to show the item; it needs at least ${RETURN_PHOTO_MIN_SIDE} pixels on its longer side`,
    )
  }
  let photo: { data: Buffer; info: { width: number; height: number } }
  try {
    photo = await sharp(bytes, {
      autoOrient: true,
      limitInputPixels: MAX_IMAGE_PIXELS,
    })
      .resize({
        width: RETURN_PHOTO_MAX_SIDE,
        height: RETURN_PHOTO_MAX_SIDE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      // JPEG has no transparency; see-through parts turn white, not black.
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85 })
      .toBuffer({ resolveWithObject: true })
  } catch {
    throw new ImageRejectedError('The file is damaged and cannot be read')
  }
  return {
    bytes: photo.data,
    width: photo.info.width,
    height: photo.info.height,
    contentHash: createHash('sha256').update(photo.data).digest('hex'),
  }
}
