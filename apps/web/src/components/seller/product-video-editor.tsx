'use client'

import { useRef, useState, type ChangeEvent } from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Card, Notice, StatusBadge } from '@/components/ui/feedback'
import { ApiError, apiRequest } from '@/lib/api-client'
import {
  canEditListing,
  MAX_VIDEO_SECONDS,
  signedUploadBody,
  validateVideoFile,
  type ProductVideo,
  type SellerProduct,
} from '@/lib/product-editor'

type UploadStage = 'requesting' | 'uploading' | 'registering'

type SignedUpload = {
  key: string
  url: string
  fields: Record<string, string>
}

/**
 * The product's one optional video. It goes straight to storage with a
 * signed form, like photos; the worker checks it and converts it to an MP4
 * with a poster, and only that converted copy is ever played.
 */
export function ProductVideoEditor({
  product,
  onProduct,
  onReload,
}: {
  product: SellerProduct
  onProduct: (product: SellerProduct) => void
  onReload: () => Promise<void>
}) {
  const editable = canEditListing(product.status)
  const inputRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<UploadStage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const video = product.video

  function signInAgain() {
    window.location.assign(
      `/sign-in?returnTo=${encodeURIComponent(`/seller/products/${product.id}`)}&reason=session-ended`,
    )
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const invalid = validateVideoFile(file)
    if (invalid) {
      setError(invalid)
      return
    }
    setError(null)
    try {
      setStage('requesting')
      const signed = await apiRequest<{ upload: SignedUpload }>(
        `/api/seller/products/${product.id}/video/uploads`,
        { method: 'POST', json: { contentType: file.type, size: file.size } },
      )
      setStage('uploading')
      const stored = await fetch(signed.upload.url, {
        method: 'POST',
        body: signedUploadBody(signed.upload.fields, file),
      })
      if (!stored.ok) {
        throw new Error(`Object storage returned status ${stored.status}`)
      }
      setStage('registering')
      const registered = await apiRequest<{ product: SellerProduct }>(
        `/api/seller/products/${product.id}/video`,
        { method: 'POST', json: { uploadKey: signed.upload.key } },
      )
      onProduct(registered.product)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        signInAgain()
        return
      }
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'The video could not be uploaded. Check your connection and try the file again.',
      )
    } finally {
      setStage(null)
    }
  }

  async function remove() {
    setRemoving(true)
    setError(null)
    try {
      const response = await apiRequest<{ product: SellerProduct }>(
        `/api/seller/products/${product.id}/video`,
        { method: 'DELETE' },
      )
      onProduct(response.product)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        signInAgain()
        return
      }
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'The video could not be removed. Check your connection and try again.',
      )
    } finally {
      setRemoving(false)
    }
  }

  const busy = stage !== null || removing

  return (
    <section aria-labelledby="video-title" className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="video-title" className="text-xl font-semibold">
            Product video
          </h2>
          <p className="mt-1 text-sm text-muted">
            One optional video, up to {MAX_VIDEO_SECONDS} seconds and 50 MB:
            MP4, MOV, or WebM. EcoKart converts it for the shop.
          </p>
        </div>
        <StatusBadge tone={videoTone(video, stage)}>
          {videoLabel(video, stage)}
        </StatusBadge>
      </div>

      <input
        ref={inputRef}
        type="file"
        aria-label="Product video"
        accept="video/mp4,video/quicktime,video/webm"
        className="sr-only"
        onChange={(event) => void chooseFile(event)}
      />

      {error ? (
        <Notice tone="danger" title={error}>
          <Button
            variant="secondary"
            className="mt-3"
            onClick={() => void onReload()}
          >
            Reload server product
          </Button>
        </Notice>
      ) : null}

      <Card flush>
        <div className="aspect-video border-b bg-surface-subtle">
          {video?.status === 'ready' && video.urls ? (
            // Sellers upload clips without caption files, and EcoKart makes
            // none, so there is no track to offer.
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              key={video.id}
              controls
              preload="metadata"
              poster={video.urls.poster}
              src={video.urls.video}
              className="h-full w-full bg-black object-contain"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center">
              <p className="max-w-sm text-sm text-muted">
                {stage
                  ? stageText(stage)
                  : video?.status === 'processing'
                    ? 'EcoKart is checking and converting the video. This page updates by itself.'
                    : video?.status === 'failed'
                      ? (video.failureReason ??
                        'The video could not be used. Remove it and try another file.')
                      : 'No video yet. A short clip of the product in use helps buyers.'}
              </p>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-muted">
            {video?.status === 'ready' && video.durationMs
              ? `${Math.round(video.durationMs / 1000)} seconds${video.width && video.height ? `, ${video.width} × ${video.height}` : ''}`
              : editable
                ? 'Shown on the product page after the photos.'
                : 'The video can change only while the listing is a draft or after rejection.'}
          </p>
          {editable ? (
            <div className="flex flex-wrap gap-2">
              {video ? (
                <ConfirmationDialog
                  title="Remove this video?"
                  description="The video leaves this product. Upload another one afterwards to replace it."
                  trigger="Remove video"
                  triggerVariant="danger"
                  confirmLabel="Remove video"
                  onConfirm={() => void remove()}
                  danger
                  triggerDisabled={busy}
                  confirmDisabled={busy}
                />
              ) : (
                <Button
                  onClick={() => inputRef.current?.click()}
                  disabled={busy}
                >
                  {stage ? stageText(stage) : 'Choose video'}
                </Button>
              )}
            </div>
          ) : null}
        </div>
      </Card>
    </section>
  )
}

function stageText(stage: UploadStage): string {
  if (stage === 'requesting') return 'Preparing the upload...'
  if (stage === 'uploading') return 'Uploading the video...'
  return 'Adding the video...'
}

function videoLabel(
  video: ProductVideo | null,
  stage: UploadStage | null,
): string {
  if (stage) return 'Uploading'
  if (!video) return 'No video'
  if (video.status === 'ready') return 'Ready'
  if (video.status === 'failed') return 'Failed'
  return 'Processing'
}

function videoTone(video: ProductVideo | null, stage: UploadStage | null) {
  if (stage || video?.status === 'processing') return 'warning' as const
  if (video?.status === 'ready') return 'success' as const
  if (video?.status === 'failed') return 'danger' as const
  return 'neutral' as const
}
