import { getAdminOrder, NotFoundError, withContext } from '@ecokart/core'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { AddressLines } from '@/components/buyer/address-form'
import { LineThumbnail, optionsText } from '@/components/buyer/line-thumbnail'
import { OrderTotals } from '@/components/buyer/order-totals'
import { InvoiceDownload } from '@/components/seller/invoice-download'
import { OrderRefresh } from '@/components/seller/order-refresh'
import { LinkButton } from '@/components/ui/button'
import { Card, Notice, StatusBadge } from '@/components/ui/feedback'
import { PageHeader } from '@/components/ui/page-header'
import { ContentLoading } from '@/components/ui/page-loading'
import { getDatabase } from '@/lib/db'
import { formatIndianDate, formatInr, formatStatusLabel } from '@/lib/format'
import { LINE_STATUS, PAYMENT_STATE, PROGRESS } from '@/lib/order-display'
import { requireAdminPageContext } from '@/lib/page-auth'
import { getStorage } from '@/lib/storage'
import { orderFilters, ordersHref } from '../filters'

export const metadata: Metadata = {
  title: 'Administrator order',
  robots: { index: false },
}
export const instant = false

export default function OrderPage(props: PageProps<'/admin/orders/[id]'>) {
  return (
    <Suspense fallback={<ContentLoading />}>
      <Order {...props} />
    </Suspense>
  )
}

async function Order({
  params,
  searchParams,
}: PageProps<'/admin/orders/[id]'>) {
  const { id } = await params
  const context = await requireAdminPageContext(`/admin/orders/${id}`)
  const filters = orderFilters(await searchParams)
  let order
  try {
    order = await withContext(getDatabase(), context, (tx) =>
      getAdminOrder(tx, context, getStorage(), id),
    )
  } catch (cause) {
    if (cause instanceof NotFoundError) notFound()
    throw cause
  }
  const parcels = [
    ...new Map(
      order.lines.flatMap((line) =>
        line.shipment ? [[line.shipment.id, line.shipment] as const] : [],
      ),
    ).values(),
  ]
  return (
    <div className="grid min-w-0 gap-6 break-words">
      <div>
        <LinkButton href={ordersHref(filters)} variant="secondary">
          Back to orders
        </LinkButton>
      </div>
      <PageHeader
        title={`Order ${order.orderNumber}`}
        description={`Placed ${formatIndianDate(order.placedAt, { includeTime: true })}`}
        actions={<OrderRefresh />}
      />
      <div className="flex flex-wrap gap-2">
        <StatusBadge>{formatStatusLabel(order.status)}</StatusBadge>
        <StatusBadge tone={PROGRESS[order.progress].tone}>
          {PROGRESS[order.progress].label}
        </StatusBadge>
        <StatusBadge>
          {order.paymentState === 'paid' && order.paymentMethod === 'cod'
            ? 'Cash collected'
            : PAYMENT_STATE[order.paymentState]}
        </StatusBadge>
      </div>
      {order.needsRefund ? (
        <Notice tone="warning" title="Needs refund">
          This cancelled order has an online payment awaiting a recorded refund.
        </Notice>
      ) : null}
      {order.cancelReason ? (
        <Notice title="Cancellation reason">{order.cancelReason}</Notice>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="grid min-w-0 gap-6">
          <section aria-labelledby="items" className="grid gap-3">
            <h2 id="items" className="text-lg font-semibold">
              Items
            </h2>
            <ul className="grid gap-3">
              {order.lines.map((line) => (
                <li key={line.id}>
                  <Card className="grid gap-3">
                    <div className="flex items-start gap-3">
                      <LineThumbnail url={line.imageUrl} />
                      <div className="min-w-0">
                        <h3 className="font-semibold">{line.title}</h3>
                        <p className="text-sm">
                          Line {line.lineNumber} ·{' '}
                          {line.sellerName ?? 'Seller unavailable'}
                        </p>
                        <p className="text-sm text-muted">SKU: {line.sku}</p>
                        <p className="text-sm">{optionsText(line.options)}</p>
                      </div>
                    </div>
                    <div>
                      <StatusBadge tone={LINE_STATUS[line.status].tone}>
                        {LINE_STATUS[line.status].label}
                      </StatusBadge>
                    </div>
                    <dl className="grid grid-cols-2 gap-3 text-sm">
                      {[
                        ['Quantity', line.quantity],
                        ['Unit price', formatInr(line.unitPricePaise)],
                        ['Before discount', formatInr(line.lineTotalPaise)],
                        ['Coupon discount', formatInr(line.discountSharePaise)],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <dt className="text-muted">{label}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                    {line.shipment ? (
                      <p className="text-sm">
                        Tracking: {line.shipment.trackingNumber}
                      </p>
                    ) : null}
                  </Card>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="parcels" className="grid gap-3">
            <h2 id="parcels" className="text-lg font-semibold">
              Parcels
            </h2>
            {parcels.length ? (
              parcels.map((parcel) => (
                <Card key={parcel.id} className="grid gap-2 text-sm">
                  <h3 className="font-semibold">{parcel.courierName}</h3>
                  <p>Tracking: {parcel.trackingNumber}</p>
                  <p>{formatStatusLabel(parcel.status)}</p>
                  <p>
                    Dispatched{' '}
                    {formatIndianDate(parcel.dispatchedAt, {
                      includeTime: true,
                    })}
                  </p>
                  {parcel.deliveredAt ? (
                    <p>
                      Delivered{' '}
                      {formatIndianDate(parcel.deliveredAt, {
                        includeTime: true,
                      })}
                    </p>
                  ) : null}
                  <p>
                    Items:{' '}
                    {order.lines
                      .filter((line) => line.shipment?.id === parcel.id)
                      .map((line) => `${line.quantity} × ${line.title}`)
                      .join(', ')}
                  </p>
                </Card>
              ))
            ) : (
              <p className="text-sm text-muted">
                No parcels have been dispatched.
              </p>
            )}
          </section>
          <section aria-labelledby="payments" className="grid gap-3">
            <h2 id="payments" className="text-lg font-semibold">
              Payments
            </h2>
            {order.payments.length ? (
              order.payments.map((payment) => (
                <Card key={payment.id} className="grid gap-2 text-sm">
                  <h3 className="font-semibold">
                    {formatStatusLabel(payment.provider)} ·{' '}
                    {formatStatusLabel(payment.status)}
                  </h3>
                  <p>{formatInr(payment.amountPaise)}</p>
                  <p>
                    {formatIndianDate(payment.createdAt, { includeTime: true })}
                  </p>
                  {payment.method ? (
                    <p>Method: {formatStatusLabel(payment.method)}</p>
                  ) : null}
                  {payment.providerOrderId ? (
                    <p className="break-all">
                      Provider order: {payment.providerOrderId}
                    </p>
                  ) : null}
                  {payment.providerPaymentId ? (
                    <p className="break-all">
                      Provider payment: {payment.providerPaymentId}
                    </p>
                  ) : null}
                  {payment.failureReason ? (
                    <Notice tone="danger" title="Payment failed">
                      {payment.failureReason}
                    </Notice>
                  ) : null}
                </Card>
              ))
            ) : (
              <p className="text-sm text-muted">No payments recorded.</p>
            )}
          </section>
          <section aria-labelledby="history" className="grid gap-3">
            <h2 id="history" className="text-lg font-semibold">
              Order history
            </h2>
            {order.events.length ? (
              <ol className="grid gap-3">
                {order.events.map((event) => (
                  <li key={event.id}>
                    <Card className="grid gap-1 text-sm">
                      <h3 className="font-semibold">
                        {formatStatusLabel(event.eventType)}
                      </h3>
                      <p>
                        {formatIndianDate(event.createdAt, {
                          includeTime: true,
                        })}{' '}
                        · {formatStatusLabel(event.actorRole)}
                      </p>
                      {event.orderItemId ? (
                        <p>
                          Line{' '}
                          {order.lines.find(
                            (line) => line.id === event.orderItemId,
                          )?.lineNumber ?? event.orderItemId}
                        </p>
                      ) : null}
                      {event.fromStatus || event.toStatus ? (
                        <p>
                          {event.fromStatus
                            ? formatStatusLabel(event.fromStatus)
                            : 'New'}{' '}
                          →{' '}
                          {event.toStatus
                            ? formatStatusLabel(event.toStatus)
                            : 'Unchanged'}
                        </p>
                      ) : null}
                      {event.note ? (
                        <p className="whitespace-pre-wrap">{event.note}</p>
                      ) : null}
                    </Card>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted">No events recorded.</p>
            )}
          </section>
        </div>
        <div className="grid min-w-0 gap-4">
          <Card className="grid gap-3">
            <h2 className="text-lg font-semibold">Order total</h2>
            <OrderTotals {...order} />
            <p className="text-sm">
              {order.paymentMethod === 'cod'
                ? 'Cash on delivery'
                : 'Online payment'}
            </p>
            {order.paidAt ? (
              <p className="text-sm">
                Paid {formatIndianDate(order.paidAt, { includeTime: true })}
              </p>
            ) : null}
            {order.cancelledAt ? (
              <p className="text-sm">
                Cancelled{' '}
                {formatIndianDate(order.cancelledAt, { includeTime: true })}
              </p>
            ) : null}
            {order.completedAt ? (
              <p className="text-sm">
                Completed{' '}
                {formatIndianDate(order.completedAt, { includeTime: true })}
              </p>
            ) : null}
          </Card>
          <Card className="grid gap-3">
            <h2 className="text-lg font-semibold">Buyer and delivery</h2>
            <p>{order.buyerName}</p>
            <p className="text-sm">{order.buyerPhone}</p>
            {order.buyerEmail ? (
              <p className="text-sm break-all">{order.buyerEmail}</p>
            ) : null}
            <AddressLines address={order.shippingAddress} />
          </Card>
          <Card className="grid gap-3">
            <h2 className="text-lg font-semibold">Invoices</h2>
            {order.invoices.length ? (
              <ul className="grid gap-4">
                {order.invoices.map((invoice) => (
                  <li key={invoice.id} className="grid gap-1 text-sm">
                    <h3 className="font-mono font-semibold break-all">
                      {invoice.invoiceNumber}
                    </h3>
                    <p>{invoice.sellerName}</p>
                    <p>{formatInr(invoice.totalPaise)}</p>
                    <p>Issued {formatIndianDate(invoice.issuedAt)}</p>
                    {invoice.cancelledAt ? (
                      <>
                        <StatusBadge tone="danger">Cancelled</StatusBadge>
                        <p>{invoice.cancelReason}</p>
                      </>
                    ) : null}
                    {invoice.pdfReady ? (
                      <InvoiceDownload id={invoice.id} area="admin" />
                    ) : (
                      <Notice title="Invoice PDF is not ready">
                        Refresh the order to check again.
                      </Notice>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No invoices available yet.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
