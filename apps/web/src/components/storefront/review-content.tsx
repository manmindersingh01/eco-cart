import type { PublicReview } from '@ecokart/core'
import { StatusBadge } from '@/components/ui/feedback'
import { formatIndianDate } from '@/lib/format'

export function ReviewContent({ review }: { review: PublicReview }) {
  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold">{review.rating} out of 5 stars</p>
        {review.verifiedPurchase ? (
          <StatusBadge tone="success">Verified purchase</StatusBadge>
        ) : null}
      </div>
      {review.title ? (
        <h3 className="font-semibold break-words">{review.title}</h3>
      ) : null}
      {review.body ? (
        <p className="whitespace-pre-wrap break-words text-sm">{review.body}</p>
      ) : null}
      <p className="text-xs text-muted break-words">
        {review.authorName}, {formatIndianDate(review.createdAt)}
      </p>
    </div>
  )
}
