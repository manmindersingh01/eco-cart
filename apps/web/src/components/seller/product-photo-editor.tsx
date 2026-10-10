'use client'

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Card, Notice, StatusBadge } from '@/components/ui/feedback'
import { Field, Input, Select } from '@/components/ui/form-controls'
import { ApiError, apiRequest } from '@/lib/api-client'
import {
  canEditListing,
  movedImageIds,
  nextPollDelay,
  shouldPollImages,
  signedUploadBody,
  validateImageFile,
  type ProductImage,
  type SellerProduct,
} from '@/lib/product-editor'

type UploadStage = 'requesting' | 'uploading' | 'registering' | 'failed'
type UploadItem = {
  id: string
  name: string
  stage: UploadStage
  error: string | null
}

type SignedUpload = {
  key: string
  url: string
  fields: Record<string, string>
  maxBytes: number
  expiresAt: string
}

export function ProductPhotoEditor({
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
  const pollAttempt = useRef(0)
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [pendingOrder, setPendingOrder] = useState(false)
  const processingIds = product.images
    .filter((image) => image.status === 'processing')
    .map((image) => image.id)
    .join(',')

  useEffect(() => {
    if (!processingIds) {
      pollAttempt.current = 0
      return undefined
    }
    let stopped = false
    let timer: number | undefined
    let controller: AbortController | undefined

    const stopRequest = () => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = undefined
      controller?.abort()
      controller = undefined
    }

    const schedule = (attempt: number) => {
      stopRequest()
      if (
        stopped ||
        !shouldPollImages(
          product.images,
          document.visibilityState === 'visible',
        )
      ) {
        return
      }
      timer = window.setTimeout(async () => {
        controller = new AbortController()
        try {
          const response = await apiRequest<{ product: SellerProduct }>(
            `/api/seller/products/${product.id}`,
            { signal: controller.signal },
          )
          if (stopped) return
          setPollError(null)
          pollAttempt.current += 1
          onProduct(response.product)
        } catch (cause) {
          if (
            stopped ||
            (cause instanceof DOMException && cause.name === 'AbortError')
          )
            return
          if (cause instanceof ApiError && cause.status === 401) {
            window.location.assign(
              `/sign-in?returnTo=${encodeURIComponent(`/seller/products/${product.id}`)}&reason=session-ended`,
            )
            return
          }
          setPollError(
            'Photo status could not be refreshed. Polling will try again.',
          )
          pollAttempt.current += 1
          schedule(pollAttempt.current)
        }
      }, nextPollDelay(attempt))
    }

    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden') stopRequest()
      else schedule(pollAttempt.current)
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    schedule(pollAttempt.current)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', visibilityChanged)
      stopRequest()
    }
  }, [onProduct, processingIds, product.id, product.images])

  function updateUpload(id: string, update: Partial<UploadItem>) {
    setUploads((current) =>
      current.map((item) => (item.id === id ? { ...item, ...update } : item)),
    )
  }

  async function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    const accepted: Array<{ id: string; file: File }> = []
    const rows = files.map((file) => {
      const id = crypto.randomUUID()
      const error = validateImageFile(file)
      const stage: UploadStage = error ? 'failed' : 'requesting'
      if (!error) accepted.push({ id, file })
      return {
        id,
        name: file.name,
        stage,
        error,
      }
    })
    setUploads((current) => [...current, ...rows])
    setMutationError(null)

    for (const { id, file } of accepted) {
      try {
        const signed = await apiRequest<{ upload: SignedUpload }>(
          `/api/seller/products/${product.id}/images/uploads`,
          {
            method: 'POST',
            json: { contentType: file.type, size: file.size },
          },
        )
        updateUpload(id, { stage: 'uploading' })
        const stored = await fetch(signed.upload.url, {
          method: 'POST',
          body: signedUploadBody(signed.upload.fields, file),
        })
        if (!stored.ok) {
          throw new Error(`Object storage returned status ${stored.status}`)
        }
        updateUpload(id, { stage: 'registering' })
        const registered = await apiRequest<{ product: SellerProduct }>(
          `/api/seller/products/${product.id}/images`,
          { method: 'POST', json: { uploadKey: signed.upload.key } },
        )
        onProduct(registered.product)
        setUploads((current) => current.filter((item) => item.id !== id))
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 401) {
          window.location.assign(
            `/sign-in?returnTo=${encodeURIComponent(`/seller/products/${product.id}`)}&reason=session-ended`,
          )
          return
        }
        updateUpload(id, {
          stage: 'failed',
          error:
            cause instanceof ApiError
              ? cause.message
              : 'This photo could not be uploaded. Remove it and try the file again.',
        })
      }
    }
  }

  async function reorder(index: number, direction: -1 | 1) {
    setPendingOrder(true)
    setMutationError(null)
    try {
      const response = await apiRequest<{ product: SellerProduct }>(
        `/api/seller/products/${product.id}/images/order`,
        {
          method: 'PUT',
          json: { imageIds: movedImageIds(product.images, index, direction) },
        },
      )
      onProduct(response.product)
    } catch (cause) {
      setMutationError(errorMessage(cause, product.id))
    } finally {
      setPendingOrder(false)
    }
  }

  return (
    <section aria-labelledby="photos-title" className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="photos-title" className="text-xl font-semibold">
            Product photos
          </h2>
          <p className="mt-1 text-sm text-muted">
            Ready photos use the resized backend URLs. Original uploads are
            never displayed.
          </p>
        </div>
        <StatusBadge>{product.images.length} of 10 photos</StatusBadge>
      </div>

      {editable ? (
        <Card>
          <h3 className="font-semibold">Upload photos</h3>
          <p className="mt-1 text-sm text-muted">
            JPEG, PNG, WebP, or AVIF, up to 10 MB each. The longer side must be
            at least 600 pixels after the worker inspects it.
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            multiple
            className="sr-only"
            onChange={(event) => void chooseFiles(event)}
          />
          <Button
            className="mt-4"
            onClick={() => inputRef.current?.click()}
            disabled={
              product.images.filter((image) => image.status !== 'failed')
                .length >= 10
            }
          >
            Choose photos
          </Button>
          {uploads.length ? (
            <ul className="mt-4 grid gap-2">
              {uploads.map((upload) => (
                <li key={upload.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="break-all font-medium">{upload.name}</span>
                    <StatusBadge
                      tone={upload.stage === 'failed' ? 'danger' : 'warning'}
                    >
                      {stageLabel(upload.stage)}
                    </StatusBadge>
                  </div>
                  {upload.error ? (
                    <p className="mt-2 text-danger">{upload.error}</p>
                  ) : null}
                  {upload.stage === 'failed' ? (
                    <Button
                      variant="quiet"
                      className="mt-2"
                      onClick={() =>
                        setUploads((current) =>
                          current.filter((item) => item.id !== upload.id),
                        )
                      }
                    >
                      Remove failed upload
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : (
        <Notice>
          Photos can change only while the product is a draft or after
          rejection.
        </Notice>
      )}

      {pollError ? <Notice tone="warning">{pollError}</Notice> : null}
      {mutationError ? (
        <Notice title={mutationError} tone="danger">
          <Button
            variant="secondary"
            className="mt-3"
            onClick={() => void onReload()}
          >
            Reload server product
          </Button>
        </Notice>
      ) : null}

      {product.images.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <h3 className="font-semibold">No photos yet</h3>
          <p className="mt-1 text-sm text-muted">
            Add the first product photo when the listing is editable.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {product.images.map((image, index) => (
            <ImageEditor
              key={JSON.stringify(image)}
              product={product}
              image={image}
              index={index}
              editable={editable}
              pendingOrder={pendingOrder}
              onProduct={onProduct}
              onReload={onReload}
              onMove={(direction) => void reorder(index, direction)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function ImageEditor({
  product,
  image,
  index,
  editable,
  pendingOrder,
  onProduct,
  onReload,
  onMove,
}: {
  product: SellerProduct
  image: ProductImage
  index: number
  editable: boolean
  pendingOrder: boolean
  onProduct: (product: SellerProduct) => void
  onReload: () => Promise<void>
  onMove: (direction: -1 | 1) => void
}) {
  const [alt, setAlt] = useState(image.alt)
  const [variantId, setVariantId] = useState(image.variantId ?? '')
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)

  async function saveMetadata(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const changes: Record<string, unknown> = {}
    if (alt !== image.alt) changes.alt = alt
    if ((variantId || null) !== image.variantId)
      changes.variantId = variantId || null
    if (!Object.keys(changes).length) {
      setFeedback('Change the alt text or variant before saving.')
      return
    }
    setPending(true)
    setFeedback(null)
    setConflict(false)
    try {
      const response = await apiRequest<{ product: SellerProduct }>(
        `/api/seller/products/${product.id}/images/${image.id}`,
        { method: 'PATCH', json: changes },
      )
      onProduct(response.product)
    } catch (cause) {
      setFeedback(errorMessage(cause, product.id))
      setConflict(cause instanceof ApiError && cause.status === 409)
    } finally {
      setPending(false)
    }
  }

  async function remove() {
    setPending(true)
    setFeedback(null)
    setConflict(false)
    try {
      const response = await apiRequest<{ product: SellerProduct }>(
        `/api/seller/products/${product.id}/images/${image.id}`,
        { method: 'DELETE' },
      )
      onProduct(response.product)
    } catch (cause) {
      setFeedback(errorMessage(cause, product.id))
      setConflict(cause instanceof ApiError && cause.status === 409)
    } finally {
      setPending(false)
    }
  }

  return (
    <Card className="p-0">
      <div className="aspect-[4/3] overflow-hidden rounded-t-xl border-b bg-surface-subtle">
        {image.status === 'ready' && image.urls ? (
          <a href={image.urls.gallery} target="_blank" rel="noreferrer">
            {/* Backend-generated catalogue size, never the original upload. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.urls.card}
              alt={image.alt || product.title}
              className="h-full w-full object-contain"
            />
          </a>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <div>
              <StatusBadge
                tone={image.status === 'failed' ? 'danger' : 'warning'}
              >
                {image.status === 'failed' ? 'Failed' : 'Processing'}
              </StatusBadge>
              <p className="mt-3 text-sm text-muted">
                {image.failureReason ??
                  'EcoKart is checking and resizing this photo.'}
              </p>
            </div>
          </div>
        )}
      </div>
      <form onSubmit={saveMetadata} noValidate>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <StatusBadge
              tone={
                image.status === 'ready'
                  ? 'success'
                  : image.status === 'failed'
                    ? 'danger'
                    : 'warning'
              }
            >
              {image.status}
            </StatusBadge>
            <span className="text-sm text-muted">Position {index + 1}</span>
            {image.width && image.height ? (
              <span className="text-sm text-muted">
                {image.width} × {image.height}px
              </span>
            ) : null}
          </div>
          <Field
            label="Alt text"
            htmlFor={`image-alt-${image.id}`}
            hint="Describe the product shown for people who cannot see the image."
            className="sm:col-span-2"
          >
            <Input
              value={alt}
              onChange={(event) => setAlt(event.target.value)}
              maxLength={200}
              disabled={!editable || pending}
            />
          </Field>
          <Field
            label="Variant shown"
            htmlFor={`image-variant-${image.id}`}
            hint="Choose No specific variant to clear the association."
            className="sm:col-span-2"
          >
            <Select
              value={variantId}
              onChange={(event) => setVariantId(event.target.value)}
              disabled={!editable || pending}
            >
              <option value="">No specific variant</option>
              {product.variants.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.sku}
                </option>
              ))}
            </Select>
          </Field>
          {feedback ? (
            <Notice tone="danger" className="sm:col-span-2">
              {feedback}
              {conflict ? (
                <Button
                  variant="secondary"
                  className="mt-3"
                  onClick={() => void onReload()}
                >
                  Reload server product
                </Button>
              ) : null}
            </Notice>
          ) : null}
        </div>
        {editable ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-surface-subtle p-4">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => onMove(-1)}
                disabled={pendingOrder || index === 0}
              >
                Move earlier
              </Button>
              <Button
                variant="secondary"
                onClick={() => onMove(1)}
                disabled={pendingOrder || index === product.images.length - 1}
              >
                Move later
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <ConfirmationDialog
                title="Delete this photo?"
                description="The photo leaves this product. Stored files may remain for past order records."
                trigger="Delete photo"
                triggerVariant="danger"
                confirmLabel="Delete photo"
                onConfirm={() => void remove()}
                danger
                triggerDisabled={pending}
                confirmDisabled={pending}
              />
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving photo...' : 'Save photo details'}
              </Button>
            </div>
          </div>
        ) : null}
      </form>
    </Card>
  )
}

function stageLabel(stage: UploadStage): string {
  if (stage === 'requesting') return 'Requesting upload'
  if (stage === 'uploading') return 'Uploading'
  if (stage === 'registering') return 'Registering'
  return 'Upload failed'
}

function errorMessage(cause: unknown, productId: string): string {
  if (cause instanceof ApiError) {
    if (cause.status === 401) {
      window.location.assign(
        `/sign-in?returnTo=${encodeURIComponent(`/seller/products/${productId}`)}&reason=session-ended`,
      )
    }
    return cause.message
  }
  return 'The photo change failed. Check your connection and try again.'
}
