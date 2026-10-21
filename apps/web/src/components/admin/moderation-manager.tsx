'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { Button, LinkButton } from '@/components/ui/button'
import { Card, Notice } from '@/components/ui/feedback'
import { Field, Select, Textarea } from '@/components/ui/form-controls'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { apiRequest, ApiError } from '@/lib/api-client'
import { formatInr, formatBasisPoints, formatIndianDate } from '@/lib/format'
import { useClientReady } from '@/lib/use-client-ready'
import type { ListingReview, QueueItem } from '@/lib/catalogue-operations'

export function ModerationQueue() {
  const [risk, setRisk] = useState('')
  const [revision, setRevision] = useState(0)
  const [items, setItems] = useState<QueueItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const ready = useClientReady()
  useEffect(() => {
    let active = true
    apiRequest<{ items: QueueItem[]; nextCursor: string | null }>(
      `/api/admin/moderation?refresh=${revision}${risk ? `&risk=${risk}` : ''}`,
    )
      .then((result) => {
        if (active) {
          setItems(result.items)
          setCursor(result.nextCursor)
        }
        return undefined
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message)
      })
      .finally(() => {
        if (active) setPending(false)
      })
    return () => {
      active = false
    }
  }, [risk, revision])
  async function more() {
    setPending(true)
    setError(null)
    try {
      const result = await apiRequest<{
        items: QueueItem[]
        nextCursor: string | null
      }>(
        `/api/admin/moderation?cursor=${encodeURIComponent(cursor!)}${risk ? `&risk=${risk}` : ''}`,
      )
      setItems((old) => [...old, ...result.items])
      setCursor(result.nextCursor)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The operation failed. Please refresh and try again.',
      )
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="grid gap-5">
      <p>
        Open reviews, highest risk first, then oldest first. Listings awaiting
        screening remain visible.
      </p>
      <form
        autoComplete="off"
        onSubmit={(event) => event.preventDefault()}
        className="grid gap-3"
      >
        <Field label="Screening risk" htmlFor="risk-filter">
          <Select
            value={risk}
            disabled={!ready || pending}
            onChange={(event) => setRisk(event.target.value)}
          >
            <option value="">All risks and awaiting screening</option>
            {['high', 'medium', 'low'].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          variant="secondary"
          onClick={() => setRevision((value) => value + 1)}
          disabled={pending}
        >
          Refresh review queue
        </Button>
      </form>
      {error ? <Notice title={error} tone="danger" /> : null}
      {pending ? <output className="block">Loading reviews…</output> : null}
      {!pending && items.length === 0 ? (
        <p>No listings waiting for review.</p>
      ) : null}
      {items.map((item) => (
        <Card key={item.reviewId}>
          <h2 className="break-words font-semibold">{item.product.title}</h2>
          <p>
            Risk: {item.risk ?? 'Awaiting screening'};{' '}
            {item.product.categoryName}
          </p>
          <ul>
            {item.flags.map((flag, index) => (
              <li key={index}>{flag.detail}</li>
            ))}
          </ul>
          <LinkButton
            href={{ pathname: `/admin/moderation/${item.product.id}` }}
            variant="secondary"
          >
            Review listing
          </LinkButton>
        </Card>
      ))}
      {cursor ? (
        <Button disabled={pending} onClick={() => void more()}>
          Load more reviews
        </Button>
      ) : null}
    </div>
  )
}

export function ModerationDetail({
  initialReview,
}: {
  initialReview: ListingReview
}) {
  const [review, setReview] = useState(initialReview)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const ready = useClientReady()
  const product = review.product
  const current = review.reviews.find((item) => item.decision === null)
  async function refresh() {
    setReview(
      await apiRequest<ListingReview>(`/api/admin/products/${product.id}`),
    )
  }
  async function decide(action: 'approve' | 'reject' | 'take-down') {
    setError(null)
    setNotice(null)
    if (
      action !== 'approve' &&
      (!reason.trim() || reason.trim().length > 500)
    ) {
      setError('Enter a reason of 1 to 500 characters.')
      return
    }
    setPending(true)
    try {
      setReview(
        await apiRequest<ListingReview>(
          `/api/admin/products/${product.id}/${action}`,
          {
            method: 'POST',
            json: action === 'approve' ? {} : { reason: reason.trim() },
          },
        ),
      )
      setNotice('Review decision saved.')
      setReason('')
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? [cause.message, ...cause.issues].join('; ')
          : 'The decision could not be saved.',
      )
      if (cause instanceof ApiError && cause.status === 409)
        await refresh().catch(() => undefined)
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="grid gap-5">
      <Card className="min-w-0">
        <h2 className="break-words text-lg font-semibold">{product.title}</h2>
        <p>Status: {product.status.replaceAll('_', ' ')}</p>
        <p>
          Seller: {review.seller.displayName}; business status:{' '}
          {review.seller.status}
        </p>
        <p>
          {product.category.path.join(' > ')}; brand:{' '}
          {product.brand?.name ?? 'Unbranded'}
        </p>
        <p className="my-3 whitespace-pre-wrap break-words">
          {product.description || 'No description'}
        </p>
        <p>Minimum quantity: {product.minOrderQuantity} per variant</p>
        <p>
          HSN: {product.hsnCode ?? product.category.defaultHsnCode ?? 'Missing'}
          ; GST:{' '}
          {formatBasisPoints(product.gstRateBps ?? product.category.gstRateBps)}
        </p>
        {product.rejectionReason ? (
          <p>Rejection reason: {product.rejectionReason}</p>
        ) : null}
        <ul className="my-3">
          {product.variants.map((variant) => (
            <li className="break-words" key={variant.id}>
              <span className="break-all">{variant.sku}</span>:{' '}
              {Object.entries(variant.options)
                .map(([name, value]) => `${name}: ${value}`)
                .join(', ')}
              ; {formatInr(variant.pricePaise)}, MRP{' '}
              {formatInr(variant.mrpPaise)}; stock {variant.stock};{' '}
              {variant.isActive ? 'Active' : 'Inactive'}
            </li>
          ))}
        </ul>
        <div className="grid gap-3 sm:grid-cols-2">
          {product.images.map((image, index) => (
            <div key={image.id}>
              {image.urls ? (
                <Image
                  src={image.urls.card}
                  alt={image.alt || `Product photo ${index + 1}`}
                  width={480}
                  height={480}
                  unoptimized
                  className="h-56 w-full rounded object-contain"
                />
              ) : null}
              <p>
                {index === 0 ? 'Cover photo' : `Supporting photo ${index}`}:{' '}
                {image.status}
                {image.failureReason ? `: ${image.failureReason}` : ''}
              </p>
            </div>
          ))}
        </div>
        {product.video?.urls ? (
          // Review the converted upload; the media contract has no caption asset.
          // oxlint-disable-next-line jsx-a11y/media-has-caption
          <video
            className="mt-4 max-h-96 w-full"
            controls
            preload="metadata"
            src={product.video.urls.video}
            poster={product.video.urls.poster}
            aria-label="Review product video"
          />
        ) : null}
        {product.video ? (
          <p>
            Video: {product.video.status}
            {product.video.failureReason
              ? `: ${product.video.failureReason}`
              : ''}
          </p>
        ) : null}
      </Card>
      <Card>
        <h2 className="font-semibold">Screening and decision</h2>
        <p className="my-2">
          {current
            ? `Screening: ${current.risk ?? 'Not finished'}`
            : 'No open review.'}
        </p>
        <ul>
          {current?.flags.map((flag, index) => (
            <li key={index}>{flag.detail}</li>
          ))}
        </ul>
        {error ? <Notice title={error} tone="danger" /> : null}
        {notice ? <output className="block">{notice}</output> : null}
        <form autoComplete="off" onSubmit={(event) => event.preventDefault()}>
          <Field
            label="Decision reason"
            htmlFor="review-reason"
            hint="Required for rejection or take-down; shown to the seller."
          >
            <Textarea
              value={reason}
              maxLength={500}
              disabled={!ready || pending}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <div className="mt-4 flex flex-wrap gap-3">
            {product.status === 'pending_review' ? (
              <>
                <ConfirmationDialog
                  title="Approve listing?"
                  description="This publishes the listing with its category GST rate. Screening and all publication checks must pass."
                  trigger="Approve listing"
                  confirmLabel="Approve listing"
                  onConfirm={() => void decide('approve')}
                  triggerDisabled={!ready || pending || !current?.risk}
                />
                <ConfirmationDialog
                  title="Reject listing?"
                  description="The reason is shown to the seller so they can correct and resubmit."
                  trigger="Reject listing"
                  confirmLabel="Reject listing"
                  onConfirm={() => void decide('reject')}
                  triggerDisabled={!ready || pending || !reason.trim()}
                  danger
                />
              </>
            ) : null}
            {product.status === 'approved' ? (
              <ConfirmationDialog
                title="Take listing down?"
                description="This immediately removes the listing from public sale and shows your reason to the seller."
                trigger="Take down listing"
                confirmLabel="Take down listing"
                onConfirm={() => void decide('take-down')}
                triggerDisabled={!ready || pending || !reason.trim()}
                danger
              />
            ) : null}
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() =>
                void refresh().catch((cause: Error) => setError(cause.message))
              }
            >
              Refresh screening
            </Button>
          </div>
        </form>
      </Card>
      <Card>
        <h2 className="font-semibold">Review history</h2>
        {review.reviews.map((item) => (
          <div className="mt-3" key={item.id}>
            <p>
              {item.decision ?? 'Pending'}; {item.risk ?? 'Awaiting screening'};{' '}
              {formatIndianDate(item.submittedAt)}
            </p>
            {item.reason ? <p className="break-words">{item.reason}</p> : null}
          </div>
        ))}
      </Card>
      <LinkButton href="/admin/moderation" variant="secondary">
        Back to review queue
      </LinkButton>
    </div>
  )
}
