'use client'

import { useCallback, useState } from 'react'
import { ProductListingEditor } from './product-listing-editor'
import { ProductPhotoEditor } from './product-photo-editor'
import { ProductVariantsEditor } from './product-variant-editor'
import { Button, LinkButton } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Card, Notice, StatusBadge } from '@/components/ui/feedback'
import { PageHeader } from '@/components/ui/page-header'
import { ApiError, apiRequest } from '@/lib/api-client'
import {
  formatBasisPoints,
  formatIndianDate,
  formatInr,
  formatStatusLabel,
} from '@/lib/format'
import { canEditListing, type SellerProduct } from '@/lib/product-editor'

export function ProductEditor({
  initialProduct,
}: {
  initialProduct: SellerProduct
}) {
  const [product, setProduct] = useState(initialProduct)
  const [reloadError, setReloadError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const editable = canEditListing(product.status)

  const reload = useCallback(async () => {
    setReloadError(null)
    try {
      const response = await apiRequest<{ product: SellerProduct }>(
        `/api/seller/products/${product.id}`,
      )
      setProduct(response.product)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        window.location.assign(
          `/sign-in?returnTo=${encodeURIComponent(`/seller/products/${product.id}`)}&reason=session-ended`,
        )
        return
      }
      setReloadError(
        cause instanceof ApiError
          ? cause.message
          : 'The current product could not be reloaded.',
      )
    }
  }, [product.id])

  async function removeProduct() {
    setDeleting(true)
    setReloadError(null)
    try {
      await apiRequest<void>(`/api/seller/products/${product.id}`, {
        method: 'DELETE',
      })
      window.location.assign('/seller/products?deleted=1')
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        window.location.assign(
          `/sign-in?returnTo=${encodeURIComponent(`/seller/products/${product.id}`)}&reason=session-ended`,
        )
        return
      }
      setReloadError(
        cause instanceof ApiError
          ? cause.message
          : 'The product could not be deleted. Check your connection and try again.',
      )
      setDeleting(false)
    }
  }

  return (
    <div className="grid gap-8">
      <PageHeader
        title={product.title}
        description={product.category.path.join(' > ')}
        actions={
          <LinkButton href="/seller/products" variant="secondary">
            Back to products
          </LinkButton>
        }
      />

      {product.rejectionReason ? (
        <Notice title="This product was rejected" tone="danger">
          {product.rejectionReason}
        </Notice>
      ) : null}
      {reloadError ? (
        <Notice title={reloadError} tone="danger">
          <Button
            variant="secondary"
            className="mt-3"
            onClick={() => void reload()}
          >
            Reload server product
          </Button>
        </Notice>
      ) : null}

      <ProductSummary product={product} />

      {editable ? (
        <ProductListingEditor
          key={JSON.stringify(listingKey(product))}
          product={product}
          onProduct={setProduct}
          onReload={reload}
        />
      ) : (
        <Card>
          <h2 className="text-lg font-semibold">Listing details are locked</h2>
          <p className="mt-2 text-sm text-muted">
            Title, category, brand, description, HSN code, highlights,
            attributes, option names, photos, SKU, and option identity cannot
            change at {formatStatusLabel(product.status)} status. Commercial
            variant values remain editable below.
          </p>
          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            <Detail
              label="Description"
              value={product.description || 'Not provided'}
            />
            <Detail
              label="Highlights"
              value={
                product.highlights.length
                  ? product.highlights.join(' • ')
                  : 'None'
              }
            />
            <Detail
              label="Attributes"
              value={
                Object.keys(product.attributes).length
                  ? Object.entries(product.attributes)
                      .map(([name, value]) => `${name}: ${value}`)
                      .join(' • ')
                  : 'None'
              }
            />
            <Detail
              label="Option names"
              value={
                product.optionNames.length
                  ? product.optionNames.join(', ')
                  : 'None'
              }
            />
          </dl>
        </Card>
      )}

      <ProductVariantsEditor
        product={product}
        onProduct={setProduct}
        onReload={reload}
      />

      <ProductPhotoEditor
        product={product}
        onProduct={setProduct}
        onReload={reload}
      />

      <Card>
        <h2 className="text-lg font-semibold text-danger">Danger area</h2>
        {editable ? (
          <>
            <p className="mt-2 text-sm text-muted">
              Deleting removes this draft or rejected product from your
              catalogue. The empty HTTP response is handled without parsing
              JSON.
            </p>
            <div className="mt-5">
              <ConfirmationDialog
                title={`Delete ${product.title}?`}
                description="This product disappears from your seller catalogue. This action cannot be undone from the portal."
                trigger="Delete product"
                triggerVariant="danger"
                confirmLabel="Delete product"
                onConfirm={() => void removeProduct()}
                danger
                triggerDisabled={deleting}
                confirmDisabled={deleting}
              />
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted">
            Only a draft or rejected product can be deleted. Products that have
            been on sale are archived through a later lifecycle flow.
          </p>
        )}
      </Card>
    </div>
  )
}

function ProductSummary({ product }: { product: SellerProduct }) {
  const price =
    product.minPricePaise === null
      ? 'No active price'
      : product.maxPricePaise === null ||
          product.minPricePaise === product.maxPricePaise
        ? formatInr(product.minPricePaise)
        : `${formatInr(product.minPricePaise)} to ${formatInr(product.maxPricePaise)}`
  const statusTone =
    product.status === 'approved'
      ? ('success' as const)
      : product.status === 'rejected'
        ? ('danger' as const)
        : product.status === 'pending_review'
          ? ('warning' as const)
          : ('neutral' as const)
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card>
        <p className="text-sm text-muted">Status</p>
        <StatusBadge tone={statusTone} className="mt-2">
          {formatStatusLabel(product.status)}
        </StatusBadge>
        <dl className="mt-4 grid gap-3">
          <Detail
            label="Created"
            value={formatIndianDate(product.createdAt, { includeTime: true })}
          />
          <Detail
            label="Updated"
            value={formatIndianDate(product.updatedAt, { includeTime: true })}
          />
          <Detail
            label="Published"
            value={
              product.publishedAt
                ? formatIndianDate(product.publishedAt, { includeTime: true })
                : 'Not published'
            }
          />
        </dl>
      </Card>
      <Card>
        <h2 className="font-semibold">Catalogue identity</h2>
        <dl className="mt-4 grid gap-3">
          <Detail label="Category" value={product.category.path.join(' > ')} />
          <Detail label="Brand" value={product.brand?.name ?? 'Unbranded'} />
          <Detail label="URL name" value={product.slug} />
        </dl>
      </Card>
      <Card>
        <h2 className="font-semibold">Tax context</h2>
        <dl className="mt-4 grid gap-3">
          <Detail
            label="Effective HSN"
            value={
              product.hsnCode ??
              product.category.defaultHsnCode ??
              'No product or category HSN'
            }
          />
          <Detail
            label="GST rate"
            value={formatBasisPoints(
              product.gstRateBps ?? product.category.gstRateBps,
            )}
          />
          <Detail
            label="GST source"
            value={
              product.gstRateBps === null
                ? 'Current category rate'
                : 'Approved product rate'
            }
          />
        </dl>
      </Card>
      <Card>
        <h2 className="font-semibold">Commercial summary</h2>
        <dl className="mt-4 grid gap-3">
          <Detail label="Price" value={price} />
          <Detail
            label="Lowest MRP"
            value={
              product.minMrpPaise === null
                ? 'No active MRP'
                : formatInr(product.minMrpPaise)
            }
          />
          <Detail
            label="Total stock"
            value={product.totalStock.toLocaleString('en-IN')}
          />
          <Detail label="Variants" value={String(product.variants.length)} />
        </dl>
      </Card>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 break-words font-medium">{value}</dd>
    </div>
  )
}

function listingKey(product: SellerProduct) {
  return {
    category: product.category.id,
    brand: product.brand?.id ?? null,
    title: product.title,
    description: product.description,
    highlights: product.highlights,
    attributes: product.attributes,
    hsnCode: product.hsnCode,
    optionNames: product.optionNames,
  }
}
