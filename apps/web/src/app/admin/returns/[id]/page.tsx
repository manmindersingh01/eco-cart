import {
  getReturn,
  getAdminOrder,
  NotFoundError,
  withContext,
} from '@ecokart/core'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { ReturnDecisions } from '@/components/admin/return-decisions'
import { ReturnRefund } from '@/components/admin/return-refund'
import { LineThumbnail, optionsText } from '@/components/buyer/line-thumbnail'
import { ReturnRefresh } from '@/components/buyer/return-refresh'
import { LinkButton } from '@/components/ui/button'
import { Card, Notice, StatusBadge } from '@/components/ui/feedback'
import { PageHeader } from '@/components/ui/page-header'
import { ContentLoading } from '@/components/ui/page-loading'
import { getDatabase } from '@/lib/db'
import { formatIndianDate, formatStatusLabel, formatInr } from '@/lib/format'
import { requireAdminPageContext } from '@/lib/page-auth'
import { RETURN_STATUS } from '@/lib/return-display'
import { getStorage } from '@/lib/storage'

export const metadata: Metadata = {
  title: 'Administrator return',
  robots: { index: false },
}
export const instant = false
const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value
export default function ReturnPage(props: PageProps<'/admin/returns/[id]'>) {
  return (
    <Suspense fallback={<ContentLoading />}>
      <Return {...props} />
    </Suspense>
  )
}
async function Return({
  params,
  searchParams,
}: PageProps<'/admin/returns/[id]'>) {
  const { id } = await params
  const context = await requireAdminPageContext(`/admin/returns/${id}`)
  const query = await searchParams
  const status = first(query.status)
  const cursor = first(query.cursor)
  let item
  let paymentMethod
  try {
    ;({ item, paymentMethod } = await withContext(
      getDatabase(),
      context,
      async (tx) => {
        const found = await getReturn(tx, context, getStorage(), id)
        const order = await getAdminOrder(
          tx,
          context,
          getStorage(),
          found.orderId,
        )
        return { item: found, paymentMethod: order.paymentMethod }
      },
    ))
  } catch (cause) {
    if (cause instanceof NotFoundError) notFound()
    throw cause
  }
  const state = RETURN_STATUS[item.status]
  return (
    <div className="grid min-w-0 gap-6 break-words">
      <div>
        <LinkButton
          href={{
            pathname: '/admin/returns',
            query: {
              ...(status ? { status } : {}),
              ...(cursor ? { cursor } : {}),
            },
          }}
          variant="secondary"
        >
          Back to returns
        </LinkButton>
      </div>
      <PageHeader
        title="Return request"
        description={`Requested ${formatIndianDate(item.createdAt, { includeTime: true })}`}
        actions={<ReturnRefresh />}
      />
      <Notice title={state.label} tone={state.tone}>
        {item.status === 'requested'
          ? 'This request is waiting for an administrator to review it.'
          : item.status === 'approved'
            ? 'An administrator has approved this return.'
            : item.status === 'rejected'
              ? 'An administrator did not approve this return. Read the decision note below.'
              : 'A refund has been recorded for this return.'}
      </Notice>
      <ReturnDecisions key={item.id} returnId={item.id} status={item.status} />
      <ReturnRefund
        key={`${item.id}-${paymentMethod}`}
        returnId={item.id}
        status={item.status}
        maxRefundPaise={item.maxRefundPaise}
        paymentMethod={paymentMethod}
      />
      <Card className="grid gap-3">
        <div className="flex items-start gap-3">
          <LineThumbnail url={item.item.imageUrl} />
          <div className="grid min-w-0 gap-1">
            <h2 className="text-lg font-semibold">{item.item.title}</h2>
            <p>{optionsText(item.item.options)}</p>
            <p className="text-sm text-muted">SKU: {item.item.sku}</p>
          </div>
        </div>
        <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
        <p>Buyer: {item.buyerName}</p>
        <p>Seller: {item.sellerName ?? 'Seller unavailable'}</p>
        <p>
          Return quantity: {item.quantity} of {item.item.lineQuantity} bought
        </p>
        <LinkButton
          href={`/admin/orders/${item.orderId}`}
          variant="secondary"
          className="w-fit"
        >
          Order {item.orderNumber}
        </LinkButton>
      </Card>
      <Card className="grid gap-3">
        <h2 className="text-lg font-semibold">Refund information</h2>
        {item.refund ? (
          <>
            <p>Recorded amount: {formatInr(item.refund.amountPaise)}</p>
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
          <>
            <p>Maximum refundable value: {formatInr(item.maxRefundPaise)}</p>
            <p>No refund has been recorded.</p>
          </>
        )}
      </Card>
      <Card className="grid gap-3">
        <h2 className="text-lg font-semibold">Buyer's reason</h2>
        <p>{formatStatusLabel(item.reasonCode)}</p>
        {item.reasonText ? (
          <p className="whitespace-pre-wrap">{item.reasonText}</p>
        ) : null}
      </Card>
      <Card className="grid gap-3">
        <h2 className="text-lg font-semibold">Administrator decision</h2>
        {item.decidedAt ? (
          <p>{formatIndianDate(item.decidedAt, { includeTime: true })}</p>
        ) : null}
        <p className="whitespace-pre-wrap">
          {item.adminNote ?? 'No decision note has been added.'}
        </p>
      </Card>
      <Card className="grid gap-3">
        <h2 className="text-lg font-semibold">Return photos</h2>
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
