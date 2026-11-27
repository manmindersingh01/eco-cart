import { getSellerOrder, NotFoundError, withContext } from '@ecokart/core'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { AddressLines } from '@/components/buyer/address-form'
import { LineThumbnail, optionsText } from '@/components/buyer/line-thumbnail'
import { InvoiceDownload } from '@/components/seller/invoice-download'
import { OrderRefresh } from '@/components/seller/order-refresh'
import { DispatchManager } from '@/components/seller/dispatch-manager'
import { LinkButton } from '@/components/ui/button'
import { Card, Notice, StatusBadge } from '@/components/ui/feedback'
import { PageHeader } from '@/components/ui/page-header'
import { ContentLoading } from '@/components/ui/page-loading'
import { getDatabase } from '@/lib/db'
import { formatIndianDate, formatInr } from '@/lib/format'
import { LINE_STATUS } from '@/lib/order-display'
import { requireSellerPageContext } from '@/lib/page-auth'
import { getStorage } from '@/lib/storage'

export const metadata: Metadata = {
  title: 'Seller order',
  robots: { index: false },
}
export const instant = false

export default function OrderPage(props: PageProps<'/seller/orders/[id]'>) {
  return (
    <Suspense fallback={<ContentLoading />}>
      <Order {...props} />
    </Suspense>
  )
}

async function Order({ params }: PageProps<'/seller/orders/[id]'>) {
  const { id } = await params
  const context = await requireSellerPageContext(`/seller/orders/${id}`)
  let order
  try {
    order = await withContext(getDatabase(), context, (tx) =>
      getSellerOrder(tx, context, getStorage(), id),
    )
  } catch (cause) {
    if (cause instanceof NotFoundError) notFound()
    throw cause
  }
  return (
    <div className="grid min-w-0 gap-6">
      <div>
        <LinkButton href="/seller/orders" variant="secondary">
          Back to orders
        </LinkButton>
      </div>
      <PageHeader
        title={`Order ${order.orderNumber}`}
        description={`Placed ${formatIndianDate(order.placedAt, { includeTime: true })}`}
        actions={<OrderRefresh />}
      />
      <DispatchManager
        orderId={order.id}
        cod={order.paymentMethod === 'cod'}
        lines={order.lines.map(
          ({ id: lineId, title, sku, quantity, status, shipment }) => ({
            id: lineId,
            title,
            sku,
            quantity,
            status,
            shipment: shipment
              ? {
                  id: shipment.id,
                  courierName: shipment.courierName,
                  trackingNumber: shipment.trackingNumber,
                  status: shipment.status,
                }
              : null,
          }),
        )}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <section aria-labelledby="seller-items" className="grid min-w-0 gap-3">
          <h2 id="seller-items" className="text-lg font-semibold">
            Your items
          </h2>
          <ul className="grid gap-3">
            {order.lines.map((line) => (
              <li key={line.id}>
                <Card className="grid gap-4">
                  <div className="flex items-start gap-3">
                    <LineThumbnail url={line.imageUrl} />
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold break-words">
                        {line.title}
                      </h3>
                      <p className="text-sm text-muted break-words">
                        SKU: {line.sku}
                      </p>
                      {optionsText(line.options) ? (
                        <p className="text-sm break-words">
                          {optionsText(line.options)}
                        </p>
                      ) : null}
                      <div className="mt-2">
                        <StatusBadge tone={LINE_STATUS[line.status].tone}>
                          {LINE_STATUS[line.status].label}
                        </StatusBadge>
                      </div>
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-muted">Quantity</dt>
                      <dd>{line.quantity}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Unit price</dt>
                      <dd>{formatInr(line.unitPricePaise)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Before discount</dt>
                      <dd>{formatInr(line.lineTotalPaise)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Coupon discount</dt>
                      <dd>{formatInr(line.discountSharePaise)}</dd>
                    </div>
                  </dl>
                  {line.shipment ? (
                    <div className="grid gap-1 border-t pt-3 text-sm break-words">
                      <p className="font-semibold">
                        {line.shipment.courierName}
                      </p>
                      <p>Tracking: {line.shipment.trackingNumber}</p>
                      <p>
                        Dispatched{' '}
                        {formatIndianDate(line.shipment.dispatchedAt)}
                      </p>
                      {line.shipment.deliveredAt ? (
                        <p>
                          Delivered{' '}
                          {formatIndianDate(line.shipment.deliveredAt)}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        </section>
        <div className="grid min-w-0 gap-4">
          <Card className="grid gap-2">
            <h2 className="text-lg font-semibold">Your items total</h2>
            <p className="text-2xl font-semibold">
              {formatInr(order.sellerTotalPaise)}
            </p>
            <p className="text-sm text-muted">
              After coupon discounts. Includes GST. This is the item value, not
              your payout.
            </p>
            <p className="text-sm">
              {order.paymentMethod === 'cod'
                ? 'Cash on delivery'
                : 'Online payment'}
            </p>
          </Card>
          <Card className="grid gap-3">
            <h2 className="text-lg font-semibold">Delivery details</h2>
            <p className="text-sm break-words">Buyer: {order.buyerName}</p>
            <AddressLines address={order.shippingAddress} />
            <p className="text-sm">
              Buyer phone:{' '}
              <a
                href={`tel:${order.buyerPhone}`}
                className="text-brand-strong underline"
              >
                {order.buyerPhone}
              </a>
            </p>
          </Card>
          <Card className="grid gap-3">
            <h2 className="text-lg font-semibold">Your invoices</h2>
            {order.invoices.length ? (
              <ul className="grid gap-4">
                {order.invoices.map((invoice) => (
                  <li key={invoice.id} className="grid gap-1 text-sm">
                    <p className="font-mono font-semibold break-all">
                      {invoice.invoiceNumber}
                    </p>
                    {invoice.cancelledAt ? (
                      <StatusBadge tone="danger">Cancelled</StatusBadge>
                    ) : null}
                    {invoice.pdfReady ? (
                      <InvoiceDownload id={invoice.id} />
                    ) : (
                      <Notice title="Invoice PDF is not ready">
                        Refresh the order to check again. If it stays
                        unavailable, ask an administrator to regenerate it.
                      </Notice>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">
                No invoice is available for this order yet. Refresh to check
                again.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
