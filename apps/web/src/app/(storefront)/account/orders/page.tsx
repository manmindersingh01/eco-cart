import { listBuyerOrders, ValidationError, withContext } from '@ecokart/core'
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
import { PROGRESS } from '@/lib/order-display'
import { getStorage } from '@/lib/storage'
import { formatPrice } from '@/lib/storefront-display'

export const metadata: Metadata = { title: 'Your orders' }
export const instant = false

export default function OrdersPage(props: PageProps<'/account/orders'>) {
  return (
    <main id="main-content" className="page-container flex-1 py-8 sm:py-10">
      <div className="grid gap-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Your orders
        </h1>
        <AccountNav current="/account/orders" />
        <Suspense fallback={<ContentLoading />}>
          <Orders {...props} />
        </Suspense>
      </div>
    </main>
  )
}

async function Orders({ searchParams }: PageProps<'/account/orders'>) {
  const { context } = await requireBuyerPage('/account/orders')
  const raw = (await searchParams).cursor
  const cursor = Array.isArray(raw) ? raw.at(-1) : raw
  let page
  try {
    page = await withContext(getDatabase(), context, (tx) =>
      listBuyerOrders(tx, context, getStorage(), cursor ? { cursor } : {}),
    )
  } catch (cause) {
    if (!(cause instanceof ValidationError)) throw cause
    return (
      <Notice tone="danger" title="This page of orders could not be shown">
        <LinkButton href="/account/orders" variant="secondary" className="mt-2">
          Show your latest orders
        </LinkButton>
      </Notice>
    )
  }

  if (!page.items.length) {
    return cursor ? (
      <EmptyState
        title="No more orders"
        description="You have reached your oldest order."
        action={
          <LinkButton href="/account/orders" variant="secondary">
            Back to your latest orders
          </LinkButton>
        }
      />
    ) : (
      <EmptyState
        title="No orders yet"
        description="Orders you place appear here, with their delivery progress and invoices."
        action={<LinkButton href="/">Start shopping</LinkButton>}
      />
    )
  }

  return (
    <div className="grid gap-4">
      <ul className="grid gap-3">
        {page.items.map((order) => {
          const progress = PROGRESS[order.progress]
          return (
            <li key={order.id}>
              <Card className="relative flex gap-3 transition-colors focus-within:border-brand hover:border-brand sm:gap-4">
                <LineThumbnail url={order.firstItem.imageUrl} />
                <div className="grid min-w-0 flex-1 gap-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-semibold">
                      <Link
                        href={`/account/orders/${order.id}`}
                        className="after:absolute after:inset-0 focus-visible:outline-none"
                      >
                        Order {order.orderNumber}
                      </Link>
                    </h2>
                    <StatusBadge tone={progress.tone}>
                      {progress.label}
                    </StatusBadge>
                  </div>
                  <p className="truncate text-sm">{order.firstItem.title}</p>
                  <p className="text-sm text-muted">
                    Placed {formatIndianDate(order.placedAt)} ·{' '}
                    {/* Every unit: 4 planters are 4 items. */}
                    {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'}{' '}
                    ·{' '}
                    <span className="font-medium text-foreground">
                      {formatPrice(order.totalPaise)}
                    </span>{' '}
                    ·{' '}
                    {order.paymentMethod === 'cod'
                      ? 'Cash on delivery'
                      : 'Online'}
                  </p>
                </div>
              </Card>
            </li>
          )
        })}
      </ul>
      {page.nextCursor || cursor ? (
        <nav
          aria-label="More orders"
          className="flex flex-wrap justify-center gap-3"
        >
          {cursor ? (
            <LinkButton href="/account/orders" variant="secondary">
              Back to your latest orders
            </LinkButton>
          ) : null}
          {page.nextCursor ? (
            <LinkButton
              href={`/account/orders?${new URLSearchParams({ cursor: page.nextCursor }).toString()}`}
            >
              Older orders
            </LinkButton>
          ) : null}
        </nav>
      ) : null}
    </div>
  )
}
