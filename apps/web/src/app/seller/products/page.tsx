import { listOwnProducts, ValidationError, withContext } from '@ecokart/core'
import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { ProductPagination } from '@/components/seller/product-pagination'
import { LinkButton } from '@/components/ui/button'
import {
  DataCard,
  DataTable,
  ResponsiveDataList,
} from '@/components/ui/data-display'
import { EmptyState, Notice, StatusBadge } from '@/components/ui/feedback'
import { PageHeader } from '@/components/ui/page-header'
import { getDatabase } from '@/lib/db'
import { formatIndianDate, formatInr, formatStatusLabel } from '@/lib/format'
import { requireSeller } from '@/lib/request-context'
import {
  isProductStatus,
  productListHref,
  type ProductStatus,
  type ProductSummary,
} from '@/lib/seller-products'
import { getStorage } from '@/lib/storage'

export const metadata: Metadata = {
  title: 'Products | EcoKart',
}

const filters: Array<{ label: string; status?: ProductStatus }> = [
  { label: 'All' },
  { label: 'Draft', status: 'draft' },
  { label: 'Pending review', status: 'pending_review' },
  { label: 'Approved', status: 'approved' },
  { label: 'Rejected', status: 'rejected' },
  { label: 'Archived', status: 'archived' },
]

function statusTone(status: ProductStatus) {
  if (status === 'approved') return 'success' as const
  if (status === 'rejected') return 'danger' as const
  if (status === 'pending_review') return 'warning' as const
  return 'neutral' as const
}

function priceLabel(product: ProductSummary): string {
  if (product.minPricePaise === null) return 'No active price'
  if (
    product.maxPricePaise === null ||
    product.maxPricePaise === product.minPricePaise
  ) {
    return formatInr(product.minPricePaise)
  }
  return `${formatInr(product.minPricePaise)} to ${formatInr(product.maxPricePaise)}`
}

function ProductThumbnail({ product }: { product: ProductSummary }) {
  return product.thumbnailUrl ? (
    // Product thumbnails are already resized, public catalogue assets.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={product.thumbnailUrl}
      alt=""
      className="size-16 rounded-lg border object-cover"
    />
  ) : (
    <div className="flex size-16 items-center justify-center rounded-lg border bg-surface-subtle text-center text-xs text-muted">
      No photo
    </div>
  )
}

export default async function SellerProductsPage({
  searchParams,
}: PageProps<'/seller/products'>) {
  const query = await searchParams
  const rawStatus = typeof query.status === 'string' ? query.status : undefined
  const cursor = typeof query.cursor === 'string' ? query.cursor : undefined
  const created = typeof query.created === 'string' ? query.created : undefined
  const status = isProductStatus(rawStatus) ? rawStatus : undefined
  let error: string | null = null
  let items: ProductSummary[] = []
  let nextCursor: string | null = null

  if (rawStatus && !status) {
    error = `The product status filter must be ${filters
      .flatMap((filter) => (filter.status ? [filter.status] : []))
      .join(', ')}.`
  } else {
    const requestHeaders = await headers()
    const { context } = await requireSeller(requestHeaders)
    try {
      const page = await withContext(getDatabase(), context, (tx) =>
        listOwnProducts(tx, getStorage(), context, {
          ...(status ? { status } : {}),
          ...(cursor ? { cursor } : {}),
          limit: 20,
        }),
      )
      items = page.items.map((product) => ({
        ...product,
        createdAt: product.createdAt.toISOString(),
        updatedAt: product.updatedAt.toISOString(),
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
        title="Products"
        description="Create draft listings and follow their review and selling status."
        actions={
          <LinkButton href="/seller/products/new">Create draft</LinkButton>
        }
      />

      {created ? (
        <Notice title="Draft created" tone="success">
          Your product was saved. Detailed editing, variants, and photos arrive
          in the next seller catalogue task.
        </Notice>
      ) : null}

      <nav aria-label="Filter products by status" className="overflow-x-auto">
        <ul className="flex min-w-max gap-2">
          {filters.map((filter) => {
            const active = filter.status
              ? filter.status === status
              : status === undefined && rawStatus === undefined
            return (
              <li key={filter.label}>
                <Link
                  href={productListHref(filter.status)}
                  aria-current={active ? 'page' : undefined}
                  className={`inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-semibold ${
                    active
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
        <Notice title="This product list could not be opened" tone="danger">
          <p>{error}</p>
          <LinkButton
            href="/seller/products"
            variant="secondary"
            className="mt-3"
          >
            Return to the first page
          </LinkButton>
        </Notice>
      ) : items.length === 0 ? (
        <EmptyState
          title={
            status
              ? `No ${formatStatusLabel(status)} products`
              : 'No products yet'
          }
          description={
            status
              ? 'Choose another status or create a new draft listing.'
              : 'Create your first draft with its initial price, stock, and variants.'
          }
          action={
            <div className="flex flex-wrap justify-center gap-3">
              {status ? (
                <LinkButton href="/seller/products" variant="secondary">
                  View all products
                </LinkButton>
              ) : null}
              <LinkButton href="/seller/products/new">Create draft</LinkButton>
            </div>
          }
        />
      ) : (
        <>
          <ResponsiveDataList
            table={
              <DataTable>
                <thead className="bg-surface-subtle text-muted">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Product</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Price</th>
                    <th className="px-4 py-3 font-semibold">Stock</th>
                    <th className="px-4 py-3 font-semibold">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((product) => (
                    <tr key={product.id}>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <ProductThumbnail product={product} />
                          <div className="min-w-0">
                            <p className="font-semibold">{product.title}</p>
                            <p className="mt-1 text-muted">
                              {product.categoryName}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <StatusBadge tone={statusTone(product.status)}>
                          {formatStatusLabel(product.status)}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-4">{priceLabel(product)}</td>
                      <td className="px-4 py-4">
                        {product.totalStock.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-4">
                        {formatIndianDate(product.updatedAt, {
                          includeTime: true,
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            }
            cards={items.map((product) => (
              <DataCard key={product.id}>
                <div className="flex items-start gap-3">
                  <ProductThumbnail product={product} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h2 className="font-semibold">{product.title}</h2>
                      <StatusBadge tone={statusTone(product.status)}>
                        {formatStatusLabel(product.status)}
                      </StatusBadge>
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      {product.categoryName}
                    </p>
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-muted">Price</dt>
                    <dd className="mt-1 font-medium">{priceLabel(product)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Total stock</dt>
                    <dd className="mt-1 font-medium">
                      {product.totalStock.toLocaleString('en-IN')}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-muted">Last updated</dt>
                    <dd className="mt-1 font-medium">
                      {formatIndianDate(product.updatedAt, {
                        includeTime: true,
                      })}
                    </dd>
                  </div>
                </dl>
              </DataCard>
            ))}
          />
          <ProductPagination
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
