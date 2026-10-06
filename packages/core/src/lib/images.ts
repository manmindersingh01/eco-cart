/*
 * Product photo formats and sizes, shared by the web app (upload limits,
 * photo addresses) and the worker (lib/image-processing.ts), which is the
 * only code that loads the image library.
 */

/** The longer side of each stored size, in pixels. */
export const IMAGE_SIZES = { thumb: 160, card: 480, gallery: 1200 } as const
export type ImageSize = keyof typeof IMAGE_SIZES
export const IMAGE_SIZE_NAMES: readonly ImageSize[] = [
  'thumb',
  'card',
  'gallery',
]

export const MIN_IMAGE_SIDE = 600
export const MAX_IMAGE_PIXELS = 50_000_000

/** The upload types sellers may send, as browsers name them. */
export const IMAGE_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const
export type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number]

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/** The public address key of one size of a photo stored at `storageKey`. */
export const imageSizeKey = (storageKey: string, size: ImageSize) =>
  `${storageKey}/${size}.webp`
