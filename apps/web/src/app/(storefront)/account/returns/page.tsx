import { listOwnReturns, ValidationError, withContext } from '@ecokart/core'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { AccountNav } from '@/components/buyer/account-nav'
import { LineThumbnail } from '@/components/buyer/line-thumbnail'
import { LinkButton } from '@/components/ui/button'
import { Card, EmptyState, Notice, StatusBadge } from '@/components/ui/feedback'
import { ContentLoading } from '@/components/ui/page-loading'
import { requireBuyerPage } from '@/lib/buyer-page'
import { getDatabase } from '@/lib/db'
import { formatIndianDate } from '@/lib/format'
import { RETURN_STATUS } from '@/lib/return-display'
import { getStorage } from '@/lib/storage'

export const metadata: Metadata = {
  title: 'Your returns',
  robots: { index: false },
}
export const instant = false

export default function ReturnsPage(props: PageProps<'/account/returns'>) {
  return (
    <main id="main-content" className="page-container flex-1 py-8 sm:py-10">
      <div className="grid gap-6">
        <h1 className="text-2xl font-semibold">Your returns</h1>
        <AccountNav current="/account/returns" />
        <Suspense fallback={<ContentLoading />}>
          <Returns {...props} />
        </Suspense>
      </div>
    </main>
  )
}

async function Returns({ searchParams }: PageProps<'/account/returns'>) {
  const { context } = await requireBuyerPage('/account/returns')
  const raw = (await searchParams).cursor
  const cursor = Array.isArray(raw) ? raw.at(-1) : raw
  let page
  try {
    page = await withContext(getDatabase(), context, (tx) =>
      listOwnReturns(tx, context, getStorage(), { cursor, limit: 20 }),
    )
  } catch (cause) {
    if (!(cause instanceof ValidationError)) throw cause
    return (
      <Notice tone="danger" title="This page of returns could not be shown">
        <p>{cause.message}</p>
        <LinkButton
          href="/account/returns"
          variant="secondary"
          className="mt-3"
        >
          Show your latest returns
        </LinkButton>
      </Notice>
    )
  }
  if (!page.items.length)
    return (
      <EmptyState
        title={cursor ? 'No more returns' : 'No returns yet'}
        description={
          cursor
            ? 'You have reached the end of this list.'
            : 'You can request a return from a delivered item in your orders.'
        }
        action={
          <LinkButton href={cursor ? '/account/returns' : '/account/orders'}>
            {cursor ? 'Show your latest returns' : 'Your orders'}
          </LinkButton>
        }
      />
    )
  return (
    <div className="grid gap-4">
      <ul className="grid gap-3">
        {page.items.map((item) => (
          <li key={item.id}>
            <Card className="flex items-start gap-3">
              <LineThumbnail url={item.item.imageUrl} />
              <div className="grid min-w-0 flex-1 gap-2">
                <h2 className="font-semibold break-words">
                  <Link
                    className="text-brand-strong hover:underline"
                    href={`/account/returns/${item.id}${cursor ? `?${new URLSearchParams({ cursor })}` : ''}`}
                  >
                    {item.item.title}
                  </Link>
                </h2>
                <StatusBadge tone={RETURN_STATUS[item.status].tone}>
                  {RETURN_STATUS[item.status].label}
                </StatusBadge>
                <p className="text-sm break-words">
                  Order {item.orderNumber} · Quantity {item.quantity}
                </p>
                <p className="text-sm text-muted">
                  Requested{' '}
                  {formatIndianDate(item.createdAt, { includeTime: true })}
                </p>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <nav aria-label="Return pages" className="flex flex-wrap gap-3">
        {cursor ? (
          <LinkButton href="/account/returns" variant="secondary">
            Show your latest returns
          </LinkButton>
        ) : null}
        {page.nextCursor ? (
          <LinkButton
            href={`/account/returns?${new URLSearchParams({ cursor: page.nextCursor })}`}
          >
            Older returns
          </LinkButton>
        ) : null}
      </nav>
    </div>
  )
}
