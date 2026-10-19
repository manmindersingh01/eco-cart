import { z } from 'zod'
import { IMAGE_CONTENT_TYPES, MAX_UPLOAD_BYTES } from '../../lib/images.ts'
import { idOf, strictObject } from '../../lib/validation.ts'

/* Returns (design doc 5.7 and 6.5). So far: the buyer's return photos. */

/** Photos a buyer may add to one return request. */
export const MAX_PHOTOS_PER_RETURN = 5

/**
 * Photos a buyer may upload in a day without sending them with a return,
 * which keeps one account from filling the bucket.
 */
export const MAX_WAITING_PHOTOS_PER_DAY = 20

export const returnPhotoUploadRequest = strictObject({
  contentType: z.enum(IMAGE_CONTENT_TYPES, {
    error: (issue) =>
      issue.input === undefined
        ? undefined
        : 'must be image/jpeg, image/png, image/webp, or image/avif',
  }),
  /** In bytes. */
  size: z
    .number()
    .int('must be a whole number')
    .min(1, 'must be at least 1 byte')
    .max(MAX_UPLOAD_BYTES, 'must be at most 10 MB'),
})

export const newReturnPhoto = strictObject({ uploadKey: z.string() })

export const returnPhotoIds = z
  .array(idOf('a photo'))
  .max(
    MAX_PHOTOS_PER_RETURN,
    `must list at most ${MAX_PHOTOS_PER_RETURN} photos`,
  )

export type ReturnPhotoStatus = 'processing' | 'ready' | 'failed'

/** A return photo as the buyer's return form shows it. */
export interface ReturnPhotoView {
  id: string
  status: ReturnPhotoStatus
  /** Why the photo could not be used, when it failed the check. */
  failureReason: string | null
  width: number | null
  height: number | null
  /** Set once the photo was sent with a return request. */
  returnRequestId: string | null
  uploadedAt: Date
}

export interface ReturnPhotoUpload {
  /** Pass back as `uploadKey` once the file is uploaded. */
  key: string
  url: string
  fields: Record<string, string>
  maxBytes: number
  expiresAt: Date
}

export interface ReturnPhotoDownload {
  /** A signed link to the photo; it stops working at `expiresAt`. */
  url: string
  expiresAt: Date
  fileName: string
}
