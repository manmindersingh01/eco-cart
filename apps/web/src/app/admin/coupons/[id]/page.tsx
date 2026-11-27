import { getCoupon, NotFoundError, withContext } from '@ecokart/core'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CouponForm } from '@/components/admin/coupon-form'
import { CouponSummary } from '@/components/admin/coupon-summary'
import { CouponToggle } from '@/components/admin/coupon-toggle'
import { EarningsRefresh } from '@/components/seller/earnings-refresh'
import { LinkButton } from '@/components/ui/button'
import { Card } from '@/components/ui/feedback'
import { PageHeader } from '@/components/ui/page-header'
import { serialiseCoupon } from '@/lib/coupon-form'
import { getDatabase } from '@/lib/db'
import { requireAdminPageContext } from '@/lib/page-auth'

export const metadata: Metadata = {
  title: 'Edit coupon',
  robots: { index: false },
}
export const instant = false
export default async function CouponPage({
  params,
}: PageProps<'/admin/coupons/[id]'>) {
  const context = await requireAdminPageContext('/admin/coupons')
  const { id } = await params
  let coupon
  try {
    coupon = await withContext(getDatabase(), context, (tx) =>
      getCoupon(tx, context, id),
    )
  } catch (cause) {
    if (cause instanceof NotFoundError) notFound()
    throw cause
  }
  const data = serialiseCoupon(coupon)
  return (
    <div className="grid gap-6">
      <PageHeader
        title={coupon.code}
        description="Review usage, change coupon terms or switch the coupon off."
        actions={
          <div className="flex flex-wrap gap-3">
            <EarningsRefresh label="Refresh coupon" />
            <LinkButton href="/admin/coupons" variant="secondary">
              Back to coupons
            </LinkButton>
          </div>
        }
      />
      <Card className="grid gap-4">
        <h2 className="text-lg font-semibold">Saved coupon</h2>
        <CouponSummary coupon={data} />
        <CouponToggle
          id={coupon.id}
          code={coupon.code}
          active={coupon.isActive}
        />
      </Card>
      <CouponForm key={coupon.id} initial={data} />
    </div>
  )
}
