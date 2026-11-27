import { getReturn, NotFoundError, withContext } from '@ecokart/core'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { AccountNav } from '@/components/buyer/account-nav'
import { LineThumbnail, optionsText } from '@/components/buyer/line-thumbnail'
import { ReturnRefresh } from '@/components/buyer/return-refresh'
import { LinkButton } from '@/components/ui/button'
import { Card, Notice, StatusBadge } from '@/components/ui/feedback'
import { ContentLoading } from '@/components/ui/page-loading'
import { requireBuyerPage } from '@/lib/buyer-page'
import { getDatabase } from '@/lib/db'
import { formatIndianDate, formatInr, formatStatusLabel } from '@/lib/format'
import { RETURN_STATUS } from '@/lib/return-display'
import { getStorage } from '@/lib/storage'

export const metadata: Metadata = {
  title: 'Your return',
  robots: { index: false },
}
export const instant = false
export default function ReturnPage(props: PageProps<'/account/returns/[id]'>) {
  return (
    <main id="main-content" className="page-container flex-1 py-8 sm:py-10">
      <Suspense fallback={<ContentLoading />}>
        <Return {...props} />
      </Suspense>
    </main>
  )
}

async function Return({
  params,
  searchParams,
}: PageProps<'/account/returns/[id]'>) {
  const { id } = await params
  const { context } = await requireBuyerPage(`/account/returns/${id}`)
  const raw = (await searchParams).cursor
  const cursor = Array.isArray(raw) ? raw.at(-1) : raw
  let item
  try {
    item = await withContext(getDatabase(), context, (tx) =>
      getReturn(tx, context, getStorage(), id),
    )
  } catch (cause) {
    if (cause instanceof NotFoundError) notFound()
    throw cause
  }
  const state = RETURN_STATUS[item.status]
  return (
    <div className="grid min-w-0 gap-6 break-words">
      <h1 className="text-2xl font-semibold">Your return</h1>
      <AccountNav current="/account/returns" />
      <div className="flex flex-wrap gap-3">
        <LinkButton
          href={{
            pathname: '/account/returns',
            query: cursor ? { cursor } : {},
          }}
          variant="secondary"
        >
          Back to returns
        </LinkButton>
        <ReturnRefresh />
      </div>
      <Notice title={state.label} tone={state.tone}>
        {state.description}
      </Notice>
      <Card className="grid gap-4">
        <div className="flex items-start gap-3">
          <LineThumbnail url={item.item.imageUrl} />
          <div className="grid min-w-0 gap-1">
            <h2 className="text-lg font-semibold">{item.item.title}</h2>
            <p>{optionsText(item.item.options)}</p>
            <p className="text-sm text-muted">SKU: {item.item.sku}</p>
            <p>{item.sellerName ?? 'Seller unavailable'}</p>
          </div>
        </div>
        <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
        <p>
          Return quantity: {item.quantity} of {item.item.lineQuantity} bought
        </p>
        <p>
          Requested {formatIndianDate(item.createdAt, { includeTime: true })}
        </p>
        <LinkButton
          href={`/account/orders/${item.orderId}`}
          variant="secondary"
          className="w-fit"
        >
          Order {item.orderNumber}
        </LinkButton>
      </Card>
      <Card className="grid gap-3">
        <h2 className="text-lg font-semibold">Your reason</h2>
        <p>{formatStatusLabel(item.reasonCode)}</p>
        {item.reasonText ? (
          <p className="whitespace-pre-wrap">{item.reasonText}</p>
        ) : null}
      </Card>
      <Card className="grid gap-3">
        <h2 className="text-lg font-semibold">Decision</h2>
        {item.decidedAt ? (
          <p>{formatIndianDate(item.decidedAt, { includeTime: true })}</p>
        ) : null}
        <p className="whitespace-pre-wrap">
          {item.adminNote ?? 'No decision note has been added.'}
        </p>
      </Card>
      <Card className="grid gap-3">
        <h2 className="text-lg font-semibold">Refund</h2>
        {item.refund ? (
          <>
            <p>Amount: {formatInr(item.refund.amountPaise)}</p>
            <p>
              Method:{' '}
              {item.refund.method === 'gateway' ? 'Razorpay' : 'Bank transfer'}
            </p>
            <p>
              Recorded{' '}
              {formatIndianDate(item.refund.recordedAt, { includeTime: true })}
            </p>
          </>
        ) : (
          <p>No refund has been recorded yet.</p>
        )}
      </Card>
      <Card className="grid gap-3">
        <h2 className="text-lg font-semibold">Your photos</h2>
        {item.photoIds.length ? (
          <ul className="grid gap-2">
            {item.photoIds.map((photoId, index) => (
              <li key={photoId}>
                <a
                  className="inline-flex min-h-11 items-center text-brand-strong underline"
                  href={`/api/return-photos/${photoId}/file`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open photo {index + 1}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p>No photos were attached.</p>
        )}
      </Card>
    </div>
  )
}
