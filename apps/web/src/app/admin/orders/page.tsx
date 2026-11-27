import { listAdminOrders, ValidationError, withContext } from '@ecokart/core'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { Button, LinkButton } from '@/components/ui/button'
import { Card, EmptyState, Notice, StatusBadge } from '@/components/ui/feedback'
import { Field, Input, Select } from '@/components/ui/form-controls'
import { PageHeader } from '@/components/ui/page-header'
import { ContentLoading } from '@/components/ui/page-loading'
import { getDatabase } from '@/lib/db'
import { formatIndianDate, formatInr, formatStatusLabel } from '@/lib/format'
import { requireAdminPageContext } from '@/lib/page-auth'
import { orderFilters, ordersHref } from './filters'

export const metadata: Metadata = {
  title: 'Administrator orders',
  robots: { index: false },
}
export const instant = false

export default function OrdersPage(props: PageProps<'/admin/orders'>) {
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Orders"
        description="Find an order and review its payment, parcels and history."
      />
      <Suspense fallback={<ContentLoading />}>
        <Orders {...props} />
      </Suspense>
    </div>
  )
}

async function Orders({ searchParams }: PageProps<'/admin/orders'>) {
  const context = await requireAdminPageContext('/admin/orders')
  const filters = orderFilters(await searchParams)
  let page
  let error: ValidationError | undefined
  try {
    page = await withContext(getDatabase(), context, (tx) =>
      listAdminOrders(tx, context, {
        status: filters.status,
        orderNumber: filters.orderNumber,
        needsRefund: filters.needsRefund === 'true',
        cursor: filters.cursor,
        limit: 20,
      }),
    )
  } catch (cause) {
    if (!(cause instanceof ValidationError)) throw cause
    error = cause
  }
  return (
    <>
      <Card>
        <form
          key={ordersHref(filters)}
          action="/admin/orders"
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <Field
            label="Order number"
            htmlFor="order-number"
            hint="Enter the full order number."
          >
            <Input
              name="orderNumber"
              id="order-number"
              defaultValue={filters.orderNumber}
            />
          </Field>
          <Field label="Status" htmlFor="status">
            <Select
              name="status"
              id="status"
              defaultValue={filters.status ?? ''}
            >
              <option value="">All statuses</option>
              {['pending_payment', 'confirmed', 'cancelled', 'completed'].map(
                (status) => (
                  <option key={status} value={status}>
                    {formatStatusLabel(status)}
                  </option>
                ),
              )}
            </Select>
          </Field>
          <Field label="Refund" htmlFor="refund">
            <Select
              name="needsRefund"
              id="refund"
              defaultValue={filters.needsRefund === 'true' ? 'true' : ''}
            >
              <option value="">All orders</option>
              <option value="true">Needs refund</option>
            </Select>
          </Field>
          <div className="flex flex-wrap items-start gap-2 sm:pt-6">
            <Button type="submit">Apply filters</Button>
            <LinkButton href="/admin/orders" variant="secondary">
              Clear
            </LinkButton>
          </div>
        </form>
      </Card>
      {error ? (
        <Notice tone="danger" title="This order list could not be opened">
          <p>{error.message}</p>
          <LinkButton
            href={ordersHref({
              ...filters,
              cursor: undefined,
              status: undefined,
            })}
            variant="secondary"
            className="mt-3"
          >
            Reset the list
          </LinkButton>
        </Notice>
      ) : !page?.items.length ? (
        <EmptyState
          title="No matching orders"
          description="Try a different order number or clear the filters."
          action={
            <LinkButton href="/admin/orders" variant="secondary">
              Show all orders
            </LinkButton>
          }
        />
      ) : (
        <>
          <ul className="grid gap-4">
            {page.items.map((order) => (
              <li key={order.id}>
                <Card className="flex flex-wrap justify-between gap-4 break-words">
                  <div className="min-w-0">
                    <h2 className="font-semibold">
                      <Link
                        className="text-brand-strong hover:underline"
                        href={`/admin/orders/${order.id}?${new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])))}`}
                      >
                        Order {order.orderNumber}
                      </Link>
                    </h2>
                    <p className="text-sm text-muted">
                      {formatIndianDate(order.placedAt, { includeTime: true })}
                    </p>
                    <p>{order.buyerName}</p>
                  </div>
                  <div className="grid gap-1">
                    <p className="font-semibold">
                      {formatInr(order.totalPaise)}
                    </p>
                    <p className="text-sm">
                      {order.paymentMethod === 'cod'
                        ? 'Cash on delivery'
                        : 'Online payment'}{' '}
                      ·{' '}
                      {order.paymentStatus
                        ? formatStatusLabel(order.paymentStatus)
                        : 'No payment recorded'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge>
                        {formatStatusLabel(order.status)}
                      </StatusBadge>
                      {order.needsRefund ? (
                        <StatusBadge tone="warning">Needs refund</StatusBadge>
                      ) : null}
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
          <nav aria-label="Order pages" className="flex flex-wrap gap-3">
            {filters.cursor ? (
              <LinkButton
                href={ordersHref({ ...filters, cursor: undefined })}
                variant="secondary"
              >
                Back to the first page
              </LinkButton>
            ) : null}
            {page.nextCursor ? (
              <LinkButton
                href={ordersHref({ ...filters, cursor: page.nextCursor })}
              >
                Next orders
              </LinkButton>
            ) : null}
          </nav>
        </>
      )}
    </>
  )
}
