import type { SellerProduct } from './product-editor'

/* The administrators' listing review (design doc 6.2), as the browser sees it. */

export type RiskLevel = 'high' | 'medium' | 'low'

export const RISK_LEVELS: readonly RiskLevel[] = ['high', 'medium', 'low']

export type ScreeningFlag = { code: string; detail: string }

export type ReviewSeller = {
  id: string
  displayName: string
  status: string
}

/** One listing waiting in the queue. */
export type ReviewQueueItem = {
  reviewId: string
  submittedAt: string
  /** Null until screening has finished. */
  risk: RiskLevel | null
  flags: ScreeningFlag[]
  product: {
    id: string
    slug: string
    title: string
    categoryName: string
    minPricePaise: number | null
    maxPricePaise: number | null
    thumbnailUrl: string | null
    /** Set when the listing was on sale before, so this is a new version. */
    publishedAt: string | null
  }
  seller: ReviewSeller
}

export type ReviewQueuePage = {
  items: ReviewQueueItem[]
  nextCursor: string | null
}

/** One submission of a listing and what became of it. */
export type ListingReviewRecord = {
  id: string
  submittedAt: string
  risk: RiskLevel | null
  flags: ScreeningFlag[]
  decision: 'approved' | 'rejected' | 'withdrawn' | null
  decidedBy: string | null
  decidedAt: string | null
  reason: string | null
}

/** A listing as the administrator reviewing it sees it. */
export type ListingReview = {
  product: SellerProduct
  seller: ReviewSeller
  /** The most recent first. */
  reviews: ListingReviewRecord[]
}

/**
 * The GST rates in force since GST 2.0, in basis points, as the server
 * checks them: 0%, 0.25%, 3%, 5%, 18%, and 40%.
 */
export const CURRENT_GST_RATES_BPS: readonly number[] = [
  0, 25, 300, 500, 1800, 4000,
]

export function riskTone(risk: RiskLevel | null) {
  if (risk === 'high') return 'danger' as const
  if (risk === 'medium') return 'warning' as const
  if (risk === 'low') return 'success' as const
  return 'neutral' as const
}

export function riskLabel(risk: RiskLevel | null): string {
  return risk ? `${risk[0]!.toUpperCase()}${risk.slice(1)} risk` : 'Screening'
}

export const isRiskLevel = (value: unknown): value is RiskLevel =>
  RISK_LEVELS.some((level) => level === value)
