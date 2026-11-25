import {
  getBuyerOrder,
  getSetting,
  NotFoundError,
  withContext,
  type BuyerOrderView,
  type OrderLineView,
} from '@ecokart/core'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { AddressLines } from '@/components/buyer/address-form'
import { LineThumbnail, optionsText } from '@/components/buyer/line-thumbnail'
import { OrderActions } from '@/components/buyer/order-actions'
import { OrderTotals } from '@/components/buyer/order-totals'
import { ReturnRequest } from '@/components/buyer/return-request'
import { Card, Notice, StatusBadge } from '@/components/ui/feedback'
import { PageLoading } from '@/components/ui/page-loading'
import { requireBuyerPage } from '@/lib/buyer-page'
import { getDatabase } from '@/lib/db'
import { formatIndianDate } from '@/lib/format'
import { LINE_STATUS, PAYMENT_STATE, PROGRESS } from '@/lib/order-display'
import { getRazorpay } from '@/lib/razorpay'
import { getStorage } from '@/lib/storage'
import { formatPrice } from '@/lib/storefront-display'

export const metadata: Metadata = {
  title: 'Your order',
  robots: { index: false },
}
export const instant = false

export default function OrderPage(props: PageProps<'/account/orders/[id]'>) {
  return (
    <main id="main-content" className="page-container flex-1 py-8 sm:py-10">
      <Suspense fallback={<PageLoading />}>
        <OrderContent {...props} />
      </Suspense>
    </main>
  )
}

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

async function OrderContent({
  params,
  searchParams,
}: PageProps<'/account/orders/[id]'>) {
  const { id } = await params
  const { context } = await requireBuyerPage(`/account/orders/${id}`)
  const query = await searchParams
  let order: BuyerOrderView
  let timeoutMinutes: number
  try {
    ;[order, timeoutMinutes] = await withContext(
      getDatabase(),
      context,
      async (tx) =>
        [
          await getBuyerOrder(tx, context, getStorage(), id),
          await getSetting(tx, 'payment_timeout_minutes'),
        ] as const,
    )
  } catch (cause) {
    if (cause instanceof NotFoundError) notFound()
    throw cause
  }

  const progress = PROGRESS[order.progress]
  const awaitingPayment = order.status === 'pending_payment'
  const online = getRazorpay() !== null
  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <Link
          href="/account/orders"
          className="w-fit text-sm font-semibold text-brand-strong underline-offset-4 hover:underline"
        >
          ← Your orders
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight break-words sm:text-3xl">
            Order {order.orderNumber}
          </h1>
          <StatusBadge tone={progress.tone}>{progress.label}</StatusBadge>
        </div>
        <p className="text-sm text-muted">
          Placed {formatIndianDate(order.placedAt, { includeTime: true })}
        </p>
      </div>

      <OrderBanner
        order={order}
        placed={first(query.placed) === '1'}
        payment={first(query.payment)}
        timeoutMinutes={timeoutMinutes}
      />

      <OrderActions
        orderId={order.id}
        orderNumber={order.orderNumber}
        canPay={awaitingPayment && order.paymentMethod === 'razorpay' && online}
        canCancel={order.canCancel}
        paid={order.paymentState === 'paid'}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <section aria-labelledby="order-items" className="grid gap-3">
          <h2 id="order-items" className="text-lg font-semibold">
            Items
          </h2>
          <ul className="grid gap-3">
            {order.lines.map((line) => (
              <li key={line.id}>
                <OrderLine line={line} />
              </li>
            ))}
          </ul>
        </section>

        <div className="grid gap-4">
          <Card className="grid gap-4">
            <h2 className="text-lg font-semibold">Payment</h2>
            <p className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                {order.paymentMethod === 'cod'
                  ? 'Cash on delivery'
                  : 'Online with Razorpay'}
              </span>
              <span className="font-medium">
                {order.paymentMethod === 'cod' && order.paymentState === 'paid'
                  ? 'Cash collected'
                  : PAYMENT_STATE[order.paymentState]}
              </span>
            </p>
            {order.paidAt ? (
              <p className="text-xs text-muted">
                Paid {formatIndianDate(order.paidAt, { includeTime: true })}
              </p>
            ) : null}
            <div className="border-t pt-4">
              <OrderTotals
                subtotalPaise={order.subtotalPaise}
                discountPaise={order.discountPaise}
                deliveryPaise={order.deliveryPaise}
                totalPaise={order.totalPaise}
                couponCode={order.couponCode}
                totalLabel={
                  order.paymentMethod === 'cod' &&
                  order.status !== 'cancelled' &&
                  order.paymentState !== 'paid'
                    ? 'To pay on delivery'
                    : 'Total'
                }
              />
            </div>
          </Card>

          <Card className="grid gap-3">
            <h2 className="text-lg font-semibold">Delivery address</h2>
            <AddressLines address={order.shippingAddress} />
          </Card>

          {order.invoices.length ? (
            <Card className="grid gap-3">
              <h2 className="text-lg font-semibold">Invoices</h2>
              <p className="text-sm text-muted">
                Each seller issues their own GST invoice.
              </p>
              <ul className="grid gap-3">
                {order.invoices.map((invoice) => (
                  <li
                    key={invoice.id}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="block font-mono font-medium">
                        {invoice.invoiceNumber}
                      </span>
                      <span className="block text-xs text-muted">
                        {invoice.sellerName}
                      </span>
                    </span>
                    {invoice.cancelledAt ? (
                      <StatusBadge tone="danger">Cancelled</StatusBadge>
                    ) : null}
                    {invoice.pdfReady ? (
                      // A plain link: the route sends the browser on to a
                      // short-lived signed address for the PDF.
                      <a
                        href={`/api/invoices/${invoice.id}/pdf`}
                        className="font-semibold text-brand-strong underline-offset-4 hover:underline"
                      >
                        Download PDF
                      </a>
                    ) : (
                      <span className="text-muted">Being prepared</span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function OrderBanner({
  order,
  placed,
  payment,
  timeoutMinutes,
}: {
  order: BuyerOrderView
  placed: boolean
  payment: string | undefined
  timeoutMinutes: number
}) {
  // The order's own state decides what is said; the address only says
  // whether the buyer has just come from checkout.
  if (order.status === 'cancelled') {
    return (
      <Notice tone="danger" title="This order was cancelled">
        {order.cancelReason ? <p>{order.cancelReason}</p> : null}
        {order.paymentState === 'refund_due' ? (
          <p className="mt-1">
            You paid online, so EcoKart refunds the full amount to the way you
            paid.
          </p>
        ) : null}
      </Notice>
    )
  }
  if (order.status === 'pending_payment') {
    const unpaidText = `Pay within ${timeoutMinutes} minutes of placing the order, or it is cancelled and the items go back on sale.`
    if (payment === 'pending') {
      return (
        <Notice tone="warning" title="We are waiting for Razorpay">
          Razorpay is still finishing your payment. Reload this page in a minute
          to see it confirmed.
        </Notice>
      )
    }
    if (payment === 'unchecked' || payment === 'unavailable') {
      return (
        <Notice tone="warning" title="Your payment is not confirmed yet">
          If you paid, your order is confirmed as soon as Razorpay tells us. If
          you did not, choose Pay now. {unpaidText}
        </Notice>
      )
    }
    return (
      <Notice tone="warning" title="Your order is waiting for payment">
        {payment === 'closed'
          ? 'You closed the payment window before paying. '
          : null}
        {unpaidText}
      </Notice>
    )
  }
  if (placed || payment === 'confirmed') {
    return (
      <Notice tone="success" title="Thank you, your order is confirmed">
        {order.paymentMethod === 'cod'
          ? `Keep ${formatPrice(order.totalPaise)} ready for the courier. `
          : 'We have received your payment. '}
        We will let you know when it is on its way.
      </Notice>
    )
  }
  return null
}

function OrderLine({ line }: { line: OrderLineView }) {
  const status = LINE_STATUS[line.status]
  const options = optionsText(line.options)
  const { shipment } = line
  return (
    <Card className="flex gap-3 sm:gap-4">
      <LineThumbnail url={line.imageUrl} />
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="min-w-0 font-semibold break-words">{line.title}</h3>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        </div>
        {options ? <p className="text-sm text-muted">{options}</p> : null}
        {line.sellerName ? (
          <p className="text-xs text-muted">Sold by {line.sellerName}</p>
        ) : null}
        <p className="text-sm">
          {line.quantity} × {formatPrice(line.unitPricePaise)} ={' '}
          <span className="font-semibold">
            {formatPrice(line.lineTotalPaise)}
          </span>
        </p>
        {shipment ? (
          <div className="mt-2 grid gap-0.5 rounded-lg border bg-surface-subtle p-3 text-sm">
            <p>
              {shipment.courierName}, tracking number{' '}
              <span className="font-mono">{shipment.trackingNumber}</span>
            </p>
            <p className="text-xs text-muted">
              {shipment.deliveredAt
                ? `Delivered ${formatIndianDate(shipment.deliveredAt)}`
                : `Dispatched ${formatIndianDate(shipment.dispatchedAt)}`}
            </p>
            {shipment.trackingUrl && !shipment.deliveredAt ? (
              <a
                href={shipment.trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-fit font-semibold text-brand-strong underline-offset-4 hover:underline"
              >
                Track your parcel
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : null}
          </div>
        ) : null}
        {line.status === 'delivered' ? (
          <ReturnRequest lineId={line.id} />
        ) : null}
      </div>
    </Card>
  )
}
