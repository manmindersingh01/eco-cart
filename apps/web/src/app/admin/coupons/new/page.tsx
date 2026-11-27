import type { Metadata } from 'next'
import { CouponForm } from '@/components/admin/coupon-form'
import { LinkButton } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { requireAdminPageContext } from '@/lib/page-auth'

export const metadata: Metadata = {
  title: 'Create coupon',
  robots: { index: false },
}
export const instant = false
export default async function NewCouponPage() {
  await requireAdminPageContext('/admin/coupons/new')
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Create coupon"
        description="Choose a unique code, discount and limits."
        actions={
          <LinkButton href="/admin/coupons" variant="secondary">
            Back to coupons
          </LinkButton>
        }
      />
      <CouponForm />
    </div>
  )
}
