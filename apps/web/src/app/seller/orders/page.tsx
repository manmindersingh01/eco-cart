import { listSellerOrders, ValidationError, withContext } from '@ecokart/core'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { LinkButton } from '@/components/ui/button'
import { Card, EmptyState, Notice, StatusBadge } from '@/components/ui/feedback'
import { PageHeader } from '@/components/ui/page-header'
import { ContentLoading } from '@/components/ui/page-loading'
import { getDatabase } from '@/lib/db'
import { formatIndianDate, formatInr } from '@/lib/format'
import { LINE_STATUS } from '@/lib/order-display'
import { requireSellerPageContext } from '@/lib/page-auth'
import { getStorage } from '@/lib/storage'

export const metadata: Metadata = {
  title: 'Seller orders',
  robots: { index: false },
}
export const instant = false

const tabs = [
  ['to_dispatch', 'To dispatch'],
  ['dispatched', 'Dispatched'],
  ['delivered', 'Delivered'],
  ['cancelled', 'Cancelled'],
] as const

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value
function listHref(tab: string, cursor?: string) {
  return `/seller/orders?${new URLSearchParams({ tab, ...(cursor ? { cursor } : {}) })}` as const
}

export default function OrdersPage(props: PageProps<'/seller/orders'>) {
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Orders"
        description="Follow your items from packing to delivery. To dispatch shows the oldest orders first."
      />
      <Suspense fallback={<ContentLoading />}>
        <Orders {...props} />
      </Suspense>
    </div>
  )
}

async function Orders({ searchParams }: PageProps<'/seller/orders'>) {
  const context = await requireSellerPageContext('/seller/orders')
  const query = await searchParams
  const tab = first(query.tab) ?? 'to_dispatch'
  const cursor = first(query.cursor)
  let page
  let error: ValidationError | undefined
  try {
    page = await withContext(getDatabase(), context, (tx) =>
      listSellerOrders(tx, context, getStorage(), {
        tab,
        ...(cursor ? { cursor } : {}),
        limit: 20,
      }),
    )
  } catch (cause) {
    if (!(cause instanceof ValidationError)) throw cause
    error = cause
  }
  return (
    <>
      <nav aria-label="Filter orders by status">
        <ul className="flex flex-wrap gap-2">
          {tabs.map(([value, label]) => (
            <li key={value}>
              <Link
                href={listHref(value)}
                aria-current={tab === value ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-semibold ${tab === value ? 'border-brand bg-brand text-white' : 'bg-surface hover:border-brand hover:text-brand-strong'}`}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {error ? (
        <Notice tone="danger" title="This order list could not be opened">
          <p>{error.message}</p>
          <LinkButton
            href="/seller/orders"
            variant="secondary"
            className="mt-3"
          >
            Return to the first page
          </LinkButton>
        </Notice>
      ) : !page?.items.length ? (
        <EmptyState
          title={cursor ? 'No more orders' : 'No orders in this status'}
          description="Choose another status or check again when an order changes."
          action={
            cursor ? (
              <LinkButton href={listHref(tab)} variant="secondary">
                Back to the first page
              </LinkButton>
            ) : undefined
          }
        />
      ) : (
        <>
          <ul className="grid gap-4">
            {page.items.map((order) => (
              <li key={order.id}>
                <Card className="grid min-w-0 gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-semibold break-words">
                        <Link
                          href={`/seller/orders/${order.id}`}
                          className="text-brand-strong underline-offset-4 hover:underline"
                        >
                          Order {order.orderNumber}
                        </Link>
                      </h2>
                      <p className="mt-1 text-sm text-muted">
                        {formatIndianDate(order.placedAt, {
                          includeTime: true,
                        })}
                      </p>
                      <p className="mt-1 break-words">{order.buyerName}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted">Your items total</p>
                      <p className="font-semibold">
                        {formatInr(order.sellerTotalPaise)}
                      </p>
                    </div>
                  </div>
                  <ul className="grid gap-2 border-t pt-3">
                    {order.lines.map((line) => (
                      <li
                        key={line.id}
                        className="flex flex-wrap items-center justify-between gap-2 text-sm"
                      >
                        <span className="min-w-0 break-words">
                          {line.quantity} × {line.title}
                        </span>
                        <StatusBadge tone={LINE_STATUS[line.status].tone}>
                          {LINE_STATUS[line.status].label}
                        </StatusBadge>
                      </li>
                    ))}
                  </ul>
                </Card>
              </li>
            ))}
          </ul>
          {cursor || page.nextCursor ? (
            <nav aria-label="Order pages" className="flex flex-wrap gap-3">
              {cursor ? (
                <LinkButton href={listHref(tab)} variant="secondary">
                  Back to the first page
                </LinkButton>
              ) : null}
              {page.nextCursor ? (
                <LinkButton href={listHref(tab, page.nextCursor)}>
                  Next orders
                </LinkButton>
              ) : null}
            </nav>
          ) : null}
        </>
      )}
    </>
  )
}
