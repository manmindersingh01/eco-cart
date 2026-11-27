import { listOwnInvoices, ValidationError, withContext } from '@ecokart/core'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { EarningsRefresh } from '@/components/seller/earnings-refresh'
import { InvoiceDownload } from '@/components/seller/invoice-download'
import { LinkButton } from '@/components/ui/button'
import { Card, EmptyState, Notice, StatusBadge } from '@/components/ui/feedback'
import { PageHeader } from '@/components/ui/page-header'
import { ContentLoading } from '@/components/ui/page-loading'
import { getDatabase } from '@/lib/db'
import { formatIndianDate, formatInr } from '@/lib/format'
import { requireSellerPageContext } from '@/lib/page-auth'

export const metadata: Metadata = {
  title: 'Seller invoices',
  robots: { index: false },
}
export const instant = false
export default function InvoicesPage(props: PageProps<'/seller/invoices'>) {
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Invoices"
        description="Your seller invoices, with the order details frozen when they were issued."
        actions={<EarningsRefresh label="Refresh invoices" />}
      />
      <Suspense fallback={<ContentLoading />}>
        <Invoices {...props} />
      </Suspense>
    </div>
  )
}
async function Invoices({ searchParams }: PageProps<'/seller/invoices'>) {
  const context = await requireSellerPageContext('/seller/invoices')
  const raw = (await searchParams).cursor
  const cursor = Array.isArray(raw) ? raw.at(-1) : raw
  let page
  try {
    page = await withContext(getDatabase(), context, (tx) =>
      listOwnInvoices(tx, context, { cursor, limit: 20 }),
    )
  } catch (cause) {
    if (!(cause instanceof ValidationError)) throw cause
    return (
      <Notice tone="danger" title="This page of invoices could not be shown">
        <p>{cause.message}</p>
        <LinkButton
          href="/seller/invoices"
          variant="secondary"
          className="mt-3"
        >
          Show latest invoices
        </LinkButton>
      </Notice>
    )
  }
  return (
    <>
      {page.items.length ? (
        <ul className="grid gap-3">
          {page.items.map((invoice) => (
            <li key={invoice.id}>
              <Card className="grid min-w-0 gap-3" data-invoice-id={invoice.id}>
                <div className="flex flex-wrap justify-between gap-3">
                  <h2 className="font-mono font-semibold break-all">
                    {invoice.invoiceNumber}
                  </h2>
                  <p className="font-semibold">
                    {formatInr(invoice.totalPaise)}
                  </p>
                </div>
                <p className="text-sm text-muted">
                  Issued{' '}
                  {formatIndianDate(invoice.issuedAt, { includeTime: true })}
                </p>
                <p className="break-words">Buyer: {invoice.buyerName}</p>
                <div>
                  <LinkButton
                    href={`/seller/orders/${invoice.orderId}`}
                    variant="secondary"
                  >
                    Order {invoice.orderNumber}
                  </LinkButton>
                </div>
                {invoice.cancelledAt ? (
                  <>
                    <StatusBadge tone="danger">Cancelled</StatusBadge>
                    <p className="text-sm break-words">
                      {invoice.cancelReason}
                    </p>
                  </>
                ) : null}
                {invoice.pdfReady ? (
                  <InvoiceDownload id={invoice.id} />
                ) : (
                  <Notice title="Invoice PDF is not ready">
                    Refresh the invoice list to check again. If it stays
                    unavailable, ask an administrator to make the PDF again.
                  </Notice>
                )}
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title={cursor ? 'No more invoices' : 'No invoices yet'}
          description="Invoices appear when your orders are confirmed. PDFs are prepared in the background."
        />
      )}
      <nav aria-label="Invoice pages" className="flex flex-wrap gap-3">
        {cursor ? (
          <LinkButton href="/seller/invoices" variant="secondary">
            Show latest invoices
          </LinkButton>
        ) : null}
        {page.nextCursor ? (
          <LinkButton
            href={`/seller/invoices?${new URLSearchParams({ cursor: page.nextCursor })}`}
          >
            Older invoices
          </LinkButton>
        ) : null}
      </nav>
    </>
  )
}
