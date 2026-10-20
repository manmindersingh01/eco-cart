import { z } from 'zod'
import { IMAGE_CONTENT_TYPES, MAX_UPLOAD_BYTES } from '../../lib/images.ts'
import { idOf, strictObject, text, wholeNumber } from '../../lib/validation.ts'

/* Returns (design doc 5.7 and 6.5): the buyer's request with its photos,
 * the administrator's decision, and the refund. */

/** Photos a buyer may add to one return request. */
export const MAX_PHOTOS_PER_RETURN = 5

/**
 * Photos a buyer may upload in a day without sending them with a return,
 * which keeps one account from filling the bucket.
 */
export const MAX_WAITING_PHOTOS_PER_DAY = 20

/**
 * Hours a photo can wait to be sent with a return. The return form is filled
 * in one sitting, so a day is plenty.
 */
export const SEND_PHOTO_WITHIN_HOURS = 24

/**
 * Photos never sent with a return are deleted once they are this old
 * (jobs.ts). It is longer than SEND_PHOTO_WITHIN_HOURS, so a photo the
 * clean-up deletes can no longer be attached to a return.
 */
export const DELETE_UNSENT_PHOTO_AFTER_HOURS = 48

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

/* Return requests (backend spec step 15). */

export const RETURN_REASONS = [
  'damaged',
  'defective',
  'wrong_item',
  'not_as_described',
  'missing_parts',
  'no_longer_needed',
  'other',
] as const
export type ReturnReason = (typeof RETURN_REASONS)[number]

export const RETURN_STATUSES = [
  'requested',
  'approved',
  'rejected',
  'refunded',
] as const
export type ReturnStatus = (typeof RETURN_STATUSES)[number]

/**
 * A buyer's return of a delivered line: `{ orderItemId, quantity?,
 * reasonCode, reasonText?, photoIds? }`. Without a quantity, everything
 * still returnable on the line is returned.
 */
export const newReturn = strictObject({
  orderItemId: idOf('an order line'),
  quantity: wholeNumber(1, 1000).optional(),
  reasonCode: z.enum(RETURN_REASONS),
  reasonText: text(1000).optional(),
  photoIds: returnPhotoIds.default([]),
}).refine((request) => request.reasonCode !== 'other' || request.reasonText, {
  path: ['reasonText'],
  message: 'is required when the reason is other',
})

/** The administrator's note is shown to the buyer and the seller. */
export const returnApproval = strictObject({ note: text(1000).optional() })

/** A rejection always says why. */
export const returnRejection = strictObject({ note: text(1000) })

const refundAmount = wholeNumber(1)

/**
 * A refund the administrator has made: through Razorpay, with the refund id
 * from its dashboard, or by bank transfer (for cash on delivery), with the
 * bank's reference in the note.
 */
export const refundRecord = z.discriminatedUnion('method', [
  strictObject({
    method: z.literal('gateway'),
    amountPaise: refundAmount,
    razorpayRefundId: z
      .string()
      .regex(
        /^rfnd_[A-Za-z0-9]{14}$/,
        'must be a Razorpay refund id like rfnd_FP8QHiV938haTz',
      ),
    note: text(500).optional(),
  }),
  strictObject({
    method: z.literal('bank_transfer'),
    amountPaise: refundAmount,
    note: text(500),
  }),
])
export type RefundRecord = z.input<typeof refundRecord>

export interface ReturnRefundView {
  amountPaise: number
  method: 'gateway' | 'bank_transfer'
  recordedAt: Date
}

/** One return, as its buyer, its seller, or an administrator sees it. */
export interface ReturnView {
  id: string
  status: ReturnStatus
  orderId: string
  orderNumber: string
  orderItemId: string
  item: {
    title: string
    options: Record<string, string>
    sku: string
    imageUrl: string | null
    unitPricePaise: number
    /** How many the buyer bought on this line. */
    lineQuantity: number
  }
  sellerId: string
  /** Null when the seller is no longer shown on EcoKart. */
  sellerName: string | null
  buyerName: string
  quantity: number
  reasonCode: ReturnReason
  reasonText: string | null
  /** Open each through the return photo file route. */
  photoIds: string[]
  /** The administrator's note, shown with the decision. */
  adminNote: string | null
  decidedAt: Date | null
  /** The most the refund of this return may be. */
  maxRefundPaise: number
  /** Null until refunded, and for sellers, who see it in their ledger. */
  refund: ReturnRefundView | null
  createdAt: Date
}
