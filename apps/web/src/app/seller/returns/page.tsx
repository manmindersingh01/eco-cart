import { listSellerReturns, ValidationError, withContext } from '@ecokart/core'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { LineThumbnail } from '@/components/buyer/line-thumbnail'
import { LinkButton } from '@/components/ui/button'
import { Card, EmptyState, Notice, StatusBadge } from '@/components/ui/feedback'
import { PageHeader } from '@/components/ui/page-header'
import { ContentLoading } from '@/components/ui/page-loading'
import { getDatabase } from '@/lib/db'
import { formatIndianDate } from '@/lib/format'
import { requireSellerPageContext } from '@/lib/page-auth'
import { RETURN_STATUS } from '@/lib/return-display'
import { getStorage } from '@/lib/storage'

export const metadata: Metadata = {
  title: 'Seller returns',
  robots: { index: false },
}
export const instant = false
const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value
const statuses = ['requested', 'approved', 'rejected', 'refunded'] as const
function listHref(status?: string, cursor?: string) {
  return `/seller/returns?${new URLSearchParams({ ...(status ? { status } : {}), ...(cursor ? { cursor } : {}) })}` as const
}
export default function ReturnsPage(props: PageProps<'/seller/returns'>) {
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Returns"
        description="Review return requests for your items and the administrator's decisions."
      />
      <Suspense fallback={<ContentLoading />}>
        <Returns {...props} />
      </Suspense>
    </div>
  )
}
async function Returns({ searchParams }: PageProps<'/seller/returns'>) {
  const context = await requireSellerPageContext('/seller/returns')
  const query = await searchParams
  const status = first(query.status) || undefined
  const cursor = first(query.cursor)
  let page
  let error: ValidationError | undefined
  try {
    page = await withContext(getDatabase(), context, (tx) =>
      listSellerReturns(tx, context, getStorage(), {
        status,
        cursor,
        limit: 20,
      }),
    )
  } catch (cause) {
    if (!(cause instanceof ValidationError)) throw cause
    error = cause
  }
  return (
    <>
      <nav aria-label="Filter returns by status">
        <ul className="flex flex-wrap gap-2">
          {[
            ['', 'All returns'],
            ...statuses.map((value) => [value, RETURN_STATUS[value].label]),
          ].map(([value, label]) => (
            <li key={value}>
              <Link
                href={listHref(value)}
                aria-current={(status ?? '') === value ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-semibold ${(status ?? '') === value ? 'border-brand bg-brand text-white dark:text-background' : 'bg-surface hover:border-brand hover:text-brand-strong'}`}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {error ? (
        <Notice tone="danger" title="This return list could not be opened">
          <p>{error.message}</p>
          <LinkButton
            href="/seller/returns"
            variant="secondary"
            className="mt-3"
          >
            Reset the list
          </LinkButton>
        </Notice>
      ) : !page?.items.length ? (
        <EmptyState
          title="No matching returns"
          description="Return requests for your items appear here. Try another status or check again later."
          action={
            cursor ? (
              <LinkButton href={listHref(status)} variant="secondary">
                Back to the first page
              </LinkButton>
            ) : undefined
          }
        />
      ) : (
        <>
          <ul className="grid gap-3">
            {page.items.map((item) => (
              <li key={item.id}>
                <Card className="flex items-start gap-3">
                  <LineThumbnail url={item.item.imageUrl} />
                  <div className="grid min-w-0 gap-2">
                    <h2 className="font-semibold break-words">
                      <Link
                        className="text-brand-strong hover:underline"
                        href={{
                          pathname: `/seller/returns/${item.id}`,
                          query: {
                            ...(status ? { status } : {}),
                            ...(cursor ? { cursor } : {}),
                          },
                        }}
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
                    <p className="text-sm break-words">
                      Buyer: {item.buyerName}
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
              <LinkButton href={listHref(status)} variant="secondary">
                Back to the first page
              </LinkButton>
            ) : null}
            {page.nextCursor ? (
              <LinkButton href={listHref(status, page.nextCursor)}>
                Older returns
              </LinkButton>
            ) : null}
          </nav>
        </>
      )}
    </>
  )
}
