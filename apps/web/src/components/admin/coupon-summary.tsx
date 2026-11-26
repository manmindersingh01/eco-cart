import type { CouponData } from '@/lib/coupon-form'
import { StatusBadge } from '@/components/ui/feedback'
import { formatBasisPoints, formatIndianDate, formatInr } from '@/lib/format'

export function CouponSummary({ coupon }: { coupon: CouponData }) {
  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex flex-wrap gap-2">
        <StatusBadge tone={coupon.isActive ? 'success' : 'neutral'}>
          {coupon.isActive ? 'Enabled' : 'Disabled'}
        </StatusBadge>
        {coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit ? (
          <StatusBadge tone="warning">Total limit reached</StatusBadge>
        ) : null}
      </div>
      {coupon.description ? (
        <p className="whitespace-pre-wrap break-words">{coupon.description}</p>
      ) : null}
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted">Discount</dt>
          <dd>
            {coupon.discountType === 'percent'
              ? formatBasisPoints(coupon.discountValue)
              : formatInr(coupon.discountValue)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Minimum order</dt>
          <dd>{formatInr(coupon.minOrderPaise)}</dd>
        </div>
        <div>
          <dt className="text-muted">Maximum discount</dt>
          <dd>
            {coupon.discountType === 'fixed'
              ? 'Not applicable (fixed discount)'
              : coupon.maxDiscountPaise === null
                ? 'No cap'
                : formatInr(coupon.maxDiscountPaise)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Uses</dt>
          <dd>
            {coupon.usedCount.toLocaleString('en-IN')} /{' '}
            {coupon.usageLimit?.toLocaleString('en-IN') ?? 'No total limit'}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Per-buyer limit</dt>
          <dd>{coupon.perUserLimit?.toLocaleString('en-IN') ?? 'No limit'}</dd>
        </div>
        <div>
          <dt className="text-muted">Starts</dt>
          <dd>{formatIndianDate(coupon.startsAt, { includeTime: true })}</dd>
        </div>
        <div>
          <dt className="text-muted">Ends</dt>
          <dd>
            {coupon.endsAt
              ? formatIndianDate(coupon.endsAt, { includeTime: true })
              : 'No end date'}
          </dd>
        </div>
      </dl>
      <p className="text-sm text-muted">
        Dates and times use India time (IST). Checkout also checks dates, order
        value and usage limits.
      </p>
    </div>
  )
}
