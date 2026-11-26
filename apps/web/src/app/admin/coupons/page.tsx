import { listCoupons, ValidationError, withContext } from '@ecokart/core'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { CouponSummary } from '@/components/admin/coupon-summary'
import { EarningsRefresh } from '@/components/seller/earnings-refresh'
import { LinkButton } from '@/components/ui/button'
import { Card, EmptyState, Notice } from '@/components/ui/feedback'
import { PageHeader } from '@/components/ui/page-header'
import { ContentLoading } from '@/components/ui/page-loading'
import { serialiseCoupon } from '@/lib/coupon-form'
import { getDatabase } from '@/lib/db'
import { requireAdminPageContext } from '@/lib/page-auth'

export const metadata: Metadata = { title: 'Coupons', robots: { index: false } }
export const instant = false
export default function CouponsPage(props: PageProps<'/admin/coupons'>) {
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Coupons"
        description="Manage discount codes and their dates and limits. Codes cannot be changed or deleted after creation."
        actions={
          <div className="flex flex-wrap gap-3">
            <EarningsRefresh label="Refresh coupons" />
            <LinkButton href="/admin/coupons/new">Create coupon</LinkButton>
          </div>
        }
      />
      <Suspense fallback={<ContentLoading />}>
        <Coupons {...props} />
      </Suspense>
    </div>
  )
}
async function Coupons({ searchParams }: PageProps<'/admin/coupons'>) {
  const context = await requireAdminPageContext('/admin/coupons')
  const query = await searchParams
  const cursor = Array.isArray(query.cursor)
    ? query.cursor.at(-1)
    : query.cursor
  let page
  try {
    page = await withContext(getDatabase(), context, (tx) =>
      listCoupons(tx, context, { cursor, limit: 20 }),
    )
  } catch (cause) {
    if (!(cause instanceof ValidationError)) throw cause
    return (
      <Notice tone="danger" title="Coupons could not be shown">
        <p>{cause.message}</p>
        <LinkButton className="mt-3" href="/admin/coupons">
          Show latest coupons
        </LinkButton>
      </Notice>
    )
  }
  return (
    <>
      <section aria-label="Coupon list">
        {page.items.length ? (
          <ul className="grid gap-4">
            {page.items.map((coupon) => (
              <li key={coupon.id} data-coupon-id={coupon.id}>
                <Card className="grid min-w-0 gap-4">
                  <h2 className="font-mono text-lg font-semibold break-all">
                    {coupon.code}
                  </h2>
                  <CouponSummary coupon={serialiseCoupon(coupon)} />
                  <div>
                    <LinkButton
                      href={`/admin/coupons/${coupon.id}`}
                      variant="secondary"
                    >
                      Edit {coupon.code}
                    </LinkButton>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title={cursor ? 'No more coupons' : 'No coupons yet'}
            description="Create a coupon to offer a discount code."
          />
        )}
      </section>
      <nav aria-label="Coupon pages" className="flex flex-wrap gap-3">
        {cursor ? (
          <LinkButton href="/admin/coupons" variant="secondary">
            Show latest coupons
          </LinkButton>
        ) : null}
        {page.nextCursor ? (
          <LinkButton
            href={{
              pathname: '/admin/coupons',
              query: { cursor: page.nextCursor },
            }}
          >
            Older coupons
          </LinkButton>
        ) : null}
      </nav>
    </>
  )
}
