import { z } from 'zod'
import { strictObject, text, wholeNumber } from '../../lib/validation.ts'
import type { ProductLabel } from '../catalogue/storefront.ts'

/** Text the buyer may leave out; a blank form field is stored as null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `must be at most ${max} characters`)
    .transform((value) => (value === '' ? null : value))
    .nullable()

const rating = wholeNumber(1, 5)
// How the buyer wants to be named, for example "Priya S.".
const authorName = text(50)
const title = optionalText(100)
const body = optionalText(2000)

/** What a buyer sends to review a product. */
export const newReview = strictObject({
  rating,
  authorName,
  title: title.default(null),
  body: body.default(null),
})

/** The fields a buyer may change in their review. */
export const reviewUpdate = strictObject({
  rating: rating.optional(),
  authorName: authorName.optional(),
  title: title.optional(),
  body: body.optional(),
})

export const REVIEW_STATUSES = ['published', 'hidden'] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

/** What an administrator sends to hide a review or show it again. */
export const reviewDecision = strictObject({
  status: z.enum(REVIEW_STATUSES, {
    error: 'must be published or hidden',
  }),
})

/** A review as visitors see it. */
export interface PublicReview {
  id: string
  rating: number
  authorName: string
  title: string | null
  body: string | null
  /** The buyer has a delivered order line for the product. */
  verifiedPurchase: boolean
  createdAt: Date
  updatedAt: Date
}

/** A buyer's own review, which they see even when it is hidden. */
export interface OwnReview extends PublicReview {
  status: ReviewStatus
}

/** A review in the administrators' list. */
export interface AdminReview extends OwnReview {
  /** Null if the product has gone since. */
  product: ProductLabel | null
  userId: string
}

export interface AdminReviewOptions {
  /** `published` (the default) or `hidden`. */
  status?: string
  cursor?: string
  limit?: number
}
