import { listSellers, ValidationError } from '@ecokart/core'
import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { SellerPagination } from '@/components/admin/seller-pagination'
import { LinkButton } from '@/components/ui/button'
import {
  DataCard,
  DataTable,
  ResponsiveDataList,
} from '@/components/ui/data-display'
import { EmptyState, Notice, StatusBadge } from '@/components/ui/feedback'
import { PageHeader } from '@/components/ui/page-header'
import {
  isSellerStatus,
  sellerDetailHref,
  sellerListHref,
  type SellerStatus,
  type SellerSummary,
} from '@/lib/admin-sellers'
import { getDatabase } from '@/lib/db'
import { formatIndianDate } from '@/lib/format'
import { requireAdmin } from '@/lib/request-context'

export const metadata: Metadata = {
  title: 'Sellers | EcoKart',
}

const filters: Array<{ label: string; status?: SellerStatus }> = [
  { label: 'All' },
  { label: 'Pending', status: 'pending' },
  { label: 'Approved', status: 'approved' },
  { label: 'Suspended', status: 'suspended' },
]

function statusTone(status: SellerStatus) {
  return status === 'approved'
    ? ('success' as const)
    : status === 'suspended'
      ? ('danger' as const)
      : ('warning' as const)
}

export default async function AdminSellersPage({
  searchParams,
}: PageProps<'/admin/sellers'>) {
  const query = await searchParams
  const rawStatus = typeof query.status === 'string' ? query.status : undefined
  const cursor = typeof query.cursor === 'string' ? query.cursor : undefined
  const status = isSellerStatus(rawStatus) ? rawStatus : undefined
  let error: string | null = null
  let items: SellerSummary[] = []
  let nextCursor: string | null = null

  if (rawStatus && !status) {
    error = 'The seller status filter must be pending, approved, or suspended.'
  } else {
    const requestHeaders = await headers()
    const { context } = await requireAdmin(requestHeaders)
    try {
      const page = await listSellers(getDatabase(), context, {
        ...(status ? { status } : {}),
        ...(cursor ? { cursor } : {}),
        limit: 20,
      })
      items = page.items.map((seller) => ({
        ...seller,
        createdAt: seller.createdAt.toISOString(),
      }))
      nextCursor = page.nextCursor
    } catch (cause) {
      if (cause instanceof ValidationError) error = cause.message
      else throw cause
    }
  }

  return (
    <div className="grid gap-7">
      <PageHeader
        title="Sellers"
        description="Create seller accounts, review pending businesses, and control marketplace access."
        actions={
          <LinkButton href="/admin/sellers/new">Create seller</LinkButton>
        }
      />

      <nav aria-label="Filter sellers by status" className="overflow-x-auto">
        <ul className="flex min-w-max gap-2">
          {filters.map((filter) => {
            const isActive = filter.status
              ? filter.status === status
              : status === undefined && rawStatus === undefined
            return (
              <li key={filter.label}>
                <Link
                  href={sellerListHref(filter.status)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-semibold ${
                    isActive
                      ? 'border-brand bg-brand text-white'
                      : 'bg-surface hover:border-brand hover:text-brand-strong'
                  }`}
                >
                  {filter.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {error ? (
        <Notice title="This seller list could not be opened" tone="danger">
          <p>{error}</p>
          <LinkButton
            href={sellerListHref(status)}
            variant="secondary"
            className="mt-3"
          >
            Return to the first page
          </LinkButton>
        </Notice>
      ) : items.length === 0 ? (
        <EmptyState
          title={status ? `No ${status} sellers` : 'No sellers yet'}
          description={
            status
              ? 'Choose another status or create a seller account.'
              : 'Create the first seller business and its owner account.'
          }
          action={
            <LinkButton href="/admin/sellers/new">Create seller</LinkButton>
          }
        />
      ) : (
        <>
          <ResponsiveDataList
            table={
              <DataTable>
                <thead className="bg-surface-subtle text-muted">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Seller</th>
                    <th className="px-4 py-3 font-semibold">Location</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Created</th>
                    <th className="px-4 py-3 text-right font-semibold">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((seller) => (
                    <tr key={seller.id}>
                      <td className="px-4 py-4">
                        <p className="font-semibold">{seller.displayName}</p>
                        <p className="mt-1 text-muted">{seller.legalName}</p>
                      </td>
                      <td className="px-4 py-4">
                        {seller.city}, {seller.stateCode}
                      </td>
                      <td className="px-4 py-4">
                        <StatusBadge tone={statusTone(seller.status)}>
                          {seller.status}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-4">
                        {formatIndianDate(seller.createdAt)}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <Link
                          href={sellerDetailHref(seller.id)}
                          className="font-semibold text-brand-strong underline-offset-4 hover:underline"
                        >
                          View seller
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            }
            cards={items.map((seller) => (
              <DataCard key={seller.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{seller.displayName}</h2>
                    <p className="mt-1 text-sm text-muted">
                      {seller.legalName}
                    </p>
                  </div>
                  <StatusBadge tone={statusTone(seller.status)}>
                    {seller.status}
                  </StatusBadge>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-muted">Location</dt>
                    <dd className="mt-1 font-medium">
                      {seller.city}, {seller.stateCode}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Created</dt>
                    <dd className="mt-1 font-medium">
                      {formatIndianDate(seller.createdAt)}
                    </dd>
                  </div>
                </dl>
                <Link
                  href={sellerDetailHref(seller.id)}
                  className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg border bg-surface px-4 py-2 text-sm font-semibold hover:border-brand hover:text-brand-strong"
                >
                  View seller
                </Link>
              </DataCard>
            ))}
          />
          <SellerPagination
            key={`${status ?? 'all'}:${cursor ?? 'first'}`}
            status={status}
            cursor={cursor}
            nextCursor={nextCursor}
          />
        </>
      )}
    </div>
  )
}
