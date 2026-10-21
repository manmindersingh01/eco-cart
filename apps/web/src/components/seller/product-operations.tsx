'use client'

import { useEffect, useState } from 'react'
import {
  MAX_VIDEO_UPLOAD_BYTES,
  MAX_VIDEO_SECONDS,
  VIDEO_CONTENT_TYPES,
} from '@ecokart/core/catalogue-contracts'
import { Button } from '@/components/ui/button'
import { Card, Notice } from '@/components/ui/feedback'
import { Field, Input } from '@/components/ui/form-controls'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { apiRequest, ApiError } from '@/lib/api-client'
import {
  minimumQuantity,
  uploadCatalogueFile,
  type UploadForm,
} from '@/lib/catalogue-operations'
import { canEditListing, type SellerProduct } from '@/lib/product-editor'
import { useClientReady } from '@/lib/use-client-ready'

type Props = {
  product: SellerProduct
  onProduct: (product: SellerProduct) => void
  onReload: () => Promise<void>
}

export function ProductOperations({ product, onProduct, onReload }: Props) {
  const [minimum, setMinimum] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const ready = useClientReady()

  async function mutate(action: string, json?: unknown) {
    setPending(true)
    setError(null)
    setNotice(null)
    try {
      const response = await apiRequest<{ product: SellerProduct }>(
        `/api/seller/products/${product.id}${action ? `/${action}` : ''}`,
        { method: action ? 'POST' : 'PATCH', ...(json ? { json } : {}) },
      )
      onProduct(response.product)
      setMinimum(null)
      setNotice(action ? 'Product status updated.' : 'Minimum quantity saved.')
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message +
              (cause instanceof ApiError && cause.issues.length
                ? ': ' + cause.issues.join('; ')
                : '')
          : 'The change could not be saved.',
      )
      if (cause instanceof ApiError && cause.status === 409) await onReload()
    } finally {
      setPending(false)
    }
  }
  const actions =
    product.status === 'draft' || product.status === 'rejected'
      ? [['submit', 'Submit for review']]
      : product.status === 'approved'
        ? [
            ['move-to-draft', 'Move to draft'],
            ['archive', 'Archive product'],
          ]
        : [
            [
              'move-to-draft',
              product.status === 'pending_review'
                ? 'Withdraw from review'
                : 'Restore to draft',
            ],
          ]
  return (
    <Card>
      <h2 className="text-lg font-semibold">Selling and publication</h2>
      <p className="mt-2 text-sm text-muted">
        Current status: {product.status.replaceAll('_', ' ')}. Moving a
        published listing to draft or archiving it removes it from sale.
      </p>
      {error ? <Notice title={error} tone="danger" /> : null}
      {notice ? <output className="block">{notice}</output> : null}
      {!product.variants.some(
        (variant) =>
          variant.isActive && variant.stock >= product.minOrderQuantity,
      ) ? (
        <Notice title="Not enough stock for the minimum order" tone="warning">
          No active variant has enough stock. Increase stock or reduce the
          minimum before buyers can order.
        </Notice>
      ) : null}
      <form
        autoComplete="off"
        className="my-5 grid max-w-xl gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          try {
            void mutate('', {
              minOrderQuantity: minimumQuantity(
                minimum ?? String(product.minOrderQuantity),
              ),
            })
          } catch (cause) {
            setError(
              cause instanceof Error
                ? cause.message
                : 'Check the minimum quantity.',
            )
          }
        }}
      >
        <Field
          label="Minimum quantity"
          htmlFor="product-minimum"
          hint="1 to 1000 units per variant. Minimum 10 allows 11. You can change this without taking the listing off sale."
        >
          <Input
            type="number"
            min={1}
            max={1000}
            step={1}
            value={minimum ?? String(product.minOrderQuantity)}
            onChange={(event) => setMinimum(event.target.value)}
            disabled={!ready || pending}
          />
        </Field>
        <Button type="submit" disabled={!ready || pending}>
          Save minimum quantity
        </Button>
      </form>
      <form
        autoComplete="off"
        onSubmit={(event) => event.preventDefault()}
        className="flex flex-wrap gap-3"
      >
        {actions.map(([action, label]) => (
          <ConfirmationDialog
            key={action}
            title={`${label}?`}
            description={
              action === 'submit'
                ? 'The server checks your photos, variants, tax details, category and brand before sending this listing for screening and review.'
                : 'The listing leaves sale or review until it is submitted and approved again.'
            }
            trigger={label}
            confirmLabel={label!}
            onConfirm={() => void mutate(action!)}
            triggerDisabled={!ready || pending}
            confirmDisabled={pending}
          />
        ))}
      </form>
    </Card>
  )
}

export function ProductVideoEditor({ product, onProduct, onReload }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [pollExpired, setPollExpired] = useState(false)
  const ready = useClientReady()
  const video = product.video
  useEffect(() => {
    if (video?.status !== 'processing') return undefined
    let active = true
    let timer: ReturnType<typeof setTimeout>
    let attempts = 0
    async function poll() {
      try {
        const result = await apiRequest<{ product: SellerProduct }>(
          `/api/seller/products/${product.id}`,
        )
        if (!active) return
        onProduct(result.product)
        if (result.product.video?.status !== 'processing') return
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Video status could not be read.',
          )
      }
      if (active && ++attempts < 60) timer = setTimeout(() => void poll(), 3000)
      else if (active) setPollExpired(true)
    }
    timer = setTimeout(() => void poll(), 2000)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [product.id, video?.status, onProduct])

  async function upload(file: File) {
    setError(null)
    if (
      !VIDEO_CONTENT_TYPES.some((type) => type === file.type) ||
      file.size < 1 ||
      file.size > MAX_VIDEO_UPLOAD_BYTES
    ) {
      setError('Use a non-empty MP4, MOV or WebM video of 50 MB or smaller.')
      return
    }
    setPending(true)
    try {
      const key = await uploadCatalogueFile(
        file,
        async () =>
          (
            await apiRequest<{ upload: UploadForm }>(
              `/api/seller/products/${product.id}/video/uploads`,
              {
                method: 'POST',
                json: { contentType: file.type, size: file.size },
              },
            )
          ).upload,
      )
      const response = await apiRequest<{ product: SellerProduct }>(
        `/api/seller/products/${product.id}/video`,
        { method: 'POST', json: { uploadKey: key } },
      )
      onProduct(response.product)
    } catch (cause) {
      setError(
        (cause instanceof Error ? cause.message : 'Upload failed.') +
          ' Reload the product before retrying; registration may have succeeded.',
      )
      await onReload()
    } finally {
      setPending(false)
    }
  }
  async function remove() {
    setPending(true)
    setError(null)
    try {
      onProduct(
        (
          await apiRequest<{ product: SellerProduct }>(
            `/api/seller/products/${product.id}/video`,
            { method: 'DELETE' },
          )
        ).product,
      )
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Video could not be removed.',
      )
      await onReload()
    } finally {
      setPending(false)
    }
  }
  return (
    <Card>
      <form autoComplete="off" onSubmit={(event) => event.preventDefault()}>
        <h2 className="text-lg font-semibold">Product video</h2>
        <p className="my-2 text-sm text-muted">
          One optional MP4, MOV or WebM. Up to 50 MB and {MAX_VIDEO_SECONDS}{' '}
          seconds. Remove the current video before replacing it.
        </p>
        {error ? <Notice title={error} tone="danger" /> : null}
        <output className="block">
          {pending
            ? 'Updating video…'
            : video
              ? `Video: ${video.status}`
              : 'No video'}
        </output>
        {video?.failureReason ? (
          <Notice title={video.failureReason} tone="danger" />
        ) : null}
        {video?.urls ? (
          // Upload previews have no caption asset in the existing media contract.
          // oxlint-disable-next-line jsx-a11y/media-has-caption
          <video
            className="my-4 max-h-96 w-full"
            controls
            preload="metadata"
            poster={video.urls.poster}
            src={video.urls.video}
            aria-label="Converted product video"
          />
        ) : null}
        {pollExpired ? (
          <output className="block">
            Processing is taking longer. Reload the product to check again.
          </output>
        ) : null}
        <Button
          variant="secondary"
          onClick={() => void onReload()}
          disabled={pending}
        >
          Refresh video status
        </Button>
        {canEditListing(product.status) ? (
          video ? (
            <div className="mt-3">
              <ConfirmationDialog
                title="Remove product video?"
                description="The converted video and its original will be removed. You can upload a replacement afterwards."
                trigger="Remove video"
                confirmLabel="Remove video"
                onConfirm={() => void remove()}
                danger
                triggerDisabled={!ready || pending}
              />
            </div>
          ) : (
            <div className="mt-3">
              <Field label="Upload product video" htmlFor="product-video">
                <Input
                  type="file"
                  accept={VIDEO_CONTENT_TYPES.join(',')}
                  disabled={!ready || pending}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) void upload(file)
                  }}
                />
              </Field>
            </div>
          )
        ) : (
          <p className="mt-3 text-sm">
            Move the listing to draft to change its video.
          </p>
        )}
      </form>
    </Card>
  )
}
