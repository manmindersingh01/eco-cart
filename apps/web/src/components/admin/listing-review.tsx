'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button, LinkButton } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Card, EmptyState, Notice, StatusBadge } from '@/components/ui/feedback'
import { Detail, DetailList } from '@/components/ui/data-display'
import { Field, Select, Textarea } from '@/components/ui/form-controls'
import { ApiError, apiRequest } from '@/lib/api-client'
import {
  formatBasisPoints,
  formatIndianDate,
  formatInr,
  formatStatusLabel,
} from '@/lib/format'
import {
  CURRENT_GST_RATES_BPS,
  RISK_LEVELS,
  riskLabel,
  riskTone,
  type ListingReview,
  type ReviewQueueItem,
  type ReviewQueuePage,
  type RiskLevel,
} from '@/lib/listing-review'
import { useClientReady } from '@/lib/use-client-ready'

function priceRange(min: number | null, max: number | null): string {
  if (min === null) return 'No active price'
  return max === null || max === min
    ? formatInr(min)
    : `${formatInr(min)} to ${formatInr(max)}`
}

/** Listings waiting for review: highest risk first, then oldest first. */
export function ListingReviewQueue() {
  const [risk, setRisk] = useState<RiskLevel | null>(null)
  const base = `/api/admin/moderation?limit=20${risk ? `&risk=${risk}` : ''}`
  // Each answer remembers the filter it is for, so a new filter shows as
  // loading until its own answer arrives.
  const [loaded, setLoaded] = useState<{
    base: string
    page: ReviewQueuePage
  } | null>(null)
  const [failure, setFailure] = useState<{
    base: string
    message: string
  } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<string | null>(null)
  const page =
    loaded?.base === base ? loaded.page : { items: [], nextCursor: null }
  const error = failure?.base === base ? failure.message : moreError
  const loading = loaded?.base !== base && failure?.base !== base

  useEffect(() => {
    const controller = new AbortController()
    apiRequest<ReviewQueuePage>(base, { signal: controller.signal })
      .then((answer) => setLoaded({ base, page: answer }))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setFailure({
            base,
            message:
              cause instanceof ApiError
                ? cause.message
                : 'The review queue could not be loaded.',
          })
      })
    return () => controller.abort()
  }, [base])

  async function more() {
    if (!page.nextCursor) return
    setLoadingMore(true)
    setMoreError(null)
    try {
      const next = await apiRequest<ReviewQueuePage>(
        `${base}&cursor=${encodeURIComponent(page.nextCursor)}`,
      )
      setLoaded({
        base,
        page: {
          items: [...page.items, ...next.items],
          nextCursor: next.nextCursor,
        },
      })
    } catch (cause) {
      setMoreError(
        cause instanceof ApiError
          ? cause.message
          : 'More listings could not be loaded.',
      )
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="grid gap-5">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Filter by risk</legend>
        {[null, ...RISK_LEVELS].map((level) => (
          <Button
            key={level ?? 'all'}
            variant={risk === level ? 'primary' : 'secondary'}
            aria-pressed={risk === level}
            onClick={() => setRisk(level)}
          >
            {level ? riskLabel(level) : 'All'}
          </Button>
        ))}
      </fieldset>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {loading ? (
        <output className="text-sm text-muted">Loading listings...</output>
      ) : page.items.length === 0 ? (
        <EmptyState
          title="No listings waiting"
          description={
            risk
              ? `No ${risk}-risk listings are waiting for review.`
              : 'Every submitted listing has been decided.'
          }
        />
      ) : (
        <ul className="grid gap-3">
          {page.items.map((item) => (
            <QueueRow key={item.reviewId} item={item} />
          ))}
        </ul>
      )}
      {page.nextCursor && !loading ? (
        <div>
          <Button
            variant="secondary"
            onClick={() => void more()}
            disabled={loadingMore}
          >
            {loadingMore ? 'Loading...' : 'Load more listings'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function QueueRow({ item }: { item: ReviewQueueItem }) {
  return (
    <li>
      <Card className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="size-20 shrink-0 overflow-hidden rounded-lg border bg-surface-subtle">
          {item.product.thumbnailUrl ? (
            // A resized catalogue size, never the original upload.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.product.thumbnailUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={riskTone(item.risk)}>
              {riskLabel(item.risk)}
            </StatusBadge>
            {item.product.publishedAt ? (
              <StatusBadge>Change to a live listing</StatusBadge>
            ) : null}
          </div>
          <h2 className="mt-2 break-words font-semibold">
            {item.product.title}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {item.seller.displayName} · {item.product.categoryName} ·{' '}
            {priceRange(item.product.minPricePaise, item.product.maxPricePaise)}
          </p>
          <p className="mt-1 text-sm text-muted">
            Submitted{' '}
            {formatIndianDate(item.submittedAt, { includeTime: true })}
            {item.flags.length > 0
              ? ` · ${item.flags.length} screening flag${item.flags.length === 1 ? '' : 's'}`
              : ''}
          </p>
        </div>
        <LinkButton
          href={{ pathname: `/admin/moderation/${item.product.id}` }}
          variant="secondary"
          className="self-start sm:self-center"
        >
          Review listing
        </LinkButton>
      </Card>
    </li>
  )
}

type Decision = 'approve' | 'reject' | 'take-down'

/** One listing with everything needed to decide, and the decisions. */
export function ListingReviewManager({
  initialReview,
}: {
  initialReview: ListingReview
}) {
  const ready = useClientReady()
  const [review, setReview] = useState(initialReview)
  const { product } = review
  const latest = review.reviews[0] ?? null
  const open = product.status === 'pending_review' && latest?.decision === null
  const screening = open && latest?.risk === null
  const categoryRate = product.category.gstRateBps
  const [gstRate, setGstRate] = useState(String(categoryRate))
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState<Decision | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const fresh = await apiRequest<ListingReview>(
      `/api/admin/products/${product.id}`,
    )
    setReview(fresh)
  }, [product.id])

  // While screening runs, the decision waits for its result.
  useEffect(() => {
    if (!screening) return undefined
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 2_500)
    return () => window.clearInterval(timer)
  }, [screening, refresh])

  async function decide(decision: Decision, body: object) {
    setPending(decision)
    setError(null)
    setDone(null)
    try {
      const decided = await apiRequest<ListingReview>(
        `/api/admin/products/${product.id}/${decision}`,
        { method: 'POST', json: body },
      )
      setReview(decided)
      setReason('')
      setDone(
        decision === 'approve'
          ? 'Approved. The listing is on sale, and search picks it up shortly.'
          : decision === 'reject'
            ? 'Rejected. The seller sees the reason and can submit again.'
            : 'Taken down. It left the shop; the seller sees the reason.',
      )
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        window.location.assign(
          `/sign-in?returnTo=${encodeURIComponent(`/admin/moderation/${product.id}`)}&reason=session-ended`,
        )
        return
      }
      setError(
        cause instanceof ApiError
          ? [cause.message, ...cause.issues].join(' ')
          : 'The decision could not be saved. Check your connection and try again.',
      )
      // Someone else may have decided; show the listing as it is now.
      if (cause instanceof ApiError && cause.status === 409) {
        await refresh().catch(() => undefined)
      }
    } finally {
      setPending(null)
    }
  }

  function approve() {
    const rate = Number(gstRate)
    void decide('approve', rate === categoryRate ? {} : { gstRateBps: rate })
  }

  function reject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!reason.trim()) {
      setError('Write the reason the seller will see.')
      return
    }
    void decide('reject', { reason: reason.trim() })
  }

  const effectiveHsn = product.hsnCode ?? product.category.defaultHsnCode
  const gstShown = product.gstRateBps ?? categoryRate

  return (
    <div className="grid gap-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted">
              {review.seller.displayName} · {product.category.path.join(' > ')}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge
                tone={
                  product.status === 'approved'
                    ? 'success'
                    : product.status === 'rejected'
                      ? 'danger'
                      : product.status === 'pending_review'
                        ? 'warning'
                        : 'neutral'
                }
              >
                {formatStatusLabel(product.status)}
              </StatusBadge>
              {open ? (
                <StatusBadge tone={riskTone(latest?.risk ?? null)}>
                  {screening
                    ? 'Screening in progress'
                    : riskLabel(latest?.risk ?? null)}
                </StatusBadge>
              ) : null}
            </div>
          </div>
          <LinkButton href="/admin/moderation" variant="secondary">
            Back to the queue
          </LinkButton>
        </div>
        {done ? (
          <Notice className="mt-4" tone="success">
            {done}
          </Notice>
        ) : null}
        {error ? (
          <Notice className="mt-4" tone="danger">
            {error}
          </Notice>
        ) : null}
      </Card>

      {latest ? (
        <Card>
          <h2 className="text-lg font-semibold">Screening</h2>
          {latest.risk === null ? (
            <p className="mt-2 text-sm text-muted">
              EcoKart is still checking this listing. This page updates when it
              finishes.
            </p>
          ) : latest.flags.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              Nothing was flagged. Checked{' '}
              {formatIndianDate(latest.submittedAt, { includeTime: true })}.
            </p>
          ) : (
            <ul className="mt-3 grid gap-2">
              {latest.flags.map((flag) => (
                <li
                  key={`${flag.code}-${flag.detail}`}
                  className="rounded-lg border p-3 text-sm"
                >
                  <span className="font-medium">
                    {formatStatusLabel(flag.code)}
                  </span>
                  <span className="text-muted">: {flag.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      <ListingMedia review={review} />

      <Card>
        <h2 className="text-lg font-semibold">Listing</h2>
        <DetailList className="mt-4">
          <Detail label="Title" value={product.title} />
          <Detail label="Brand" value={product.brand?.name ?? 'Unbranded'} />
          <Detail
            label="Minimum order"
            value={`${product.minOrderQuantity.toLocaleString('en-IN')} of a variant`}
          />
          <Detail
            label="HSN code"
            code
            value={
              effectiveHsn
                ? `${effectiveHsn}${product.hsnCode ? '' : ' (category default)'}`
                : ''
            }
          />
          <Detail
            label="GST rate"
            value={`${formatBasisPoints(gstShown)}${product.gstRateBps === null ? ' (category rate)' : ''}`}
          />
          <Detail
            label="Price"
            value={priceRange(product.minPricePaise, product.maxPricePaise)}
          />
        </DetailList>
        {product.description ? (
          <p className="mt-5 whitespace-pre-line break-words text-sm">
            {product.description}
          </p>
        ) : null}
        {product.highlights.length > 0 ? (
          <ul className="mt-4 list-disc pl-5 text-sm">
            {product.highlights.map((highlight) => (
              <li key={highlight}>{highlight}</li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card flush>
        <h2 className="p-5 pb-0 text-lg font-semibold">Variants</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
            <thead className="border-y bg-surface-subtle text-muted">
              <tr>
                <th className="px-5 py-2 font-medium">SKU</th>
                <th className="px-3 py-2 font-medium">Options</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-right font-medium">MRP</th>
                <th className="px-3 py-2 text-right font-medium">Stock</th>
                <th className="px-5 py-2 font-medium">Active</th>
              </tr>
            </thead>
            <tbody>
              {product.variants.map((variant) => (
                <tr key={variant.id} className="border-b last:border-b-0">
                  <td className="whitespace-nowrap px-5 py-2 font-mono">
                    {variant.sku}
                  </td>
                  <td className="px-3 py-2">
                    {Object.entries(variant.options)
                      .map(([name, value]) => `${name}: ${value}`)
                      .join(', ') || 'None'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {formatInr(variant.pricePaise)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {formatInr(variant.mrpPaise)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {variant.stock.toLocaleString('en-IN')}
                  </td>
                  <td className="px-5 py-2">
                    {variant.isActive ? 'Yes' : 'No'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {open ? (
        <Card>
          <h2 className="text-lg font-semibold">Decision</h2>
          {screening ? (
            <p className="mt-2 text-sm text-muted">
              Decide once screening has finished.
            </p>
          ) : null}
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <div className="grid content-start gap-4">
              <Field
                label="GST rate on approval"
                htmlFor="approve-gst-rate"
                hint="The category's rate applies unless you choose another."
              >
                <Select
                  value={gstRate}
                  onChange={(event) => setGstRate(event.target.value)}
                  disabled={!ready || pending !== null}
                >
                  {CURRENT_GST_RATES_BPS.map((rate) => (
                    <option key={rate} value={rate}>
                      {formatBasisPoints(rate)}
                      {rate === categoryRate ? ' (category rate)' : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <div>
                <Button
                  onClick={approve}
                  disabled={!ready || pending !== null || screening}
                >
                  {pending === 'approve' ? 'Approving...' : 'Approve listing'}
                </Button>
              </div>
            </div>
            <form
              onSubmit={reject}
              noValidate
              autoComplete="off"
              className="grid content-start gap-4"
            >
              <Field
                label="Reason for rejecting"
                htmlFor="reject-reason"
                hint="The seller sees this and fixes the listing from it."
              >
                <Textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={500}
                  rows={3}
                  disabled={!ready || pending !== null}
                />
              </Field>
              <div>
                <Button
                  type="submit"
                  variant="danger"
                  disabled={!ready || pending !== null || screening}
                >
                  {pending === 'reject' ? 'Rejecting...' : 'Reject listing'}
                </Button>
              </div>
            </form>
          </div>
        </Card>
      ) : null}

      {product.status === 'approved' ? (
        <Card>
          <h2 className="text-lg font-semibold">Take down</h2>
          <p className="mt-2 max-w-prose text-sm text-muted">
            Taking the listing down removes it from the shop at once, for
            example after a complaint. The seller sees the reason and can fix
            the listing and submit it again.
          </p>
          <Field
            label="Reason for taking it down"
            htmlFor="take-down-reason"
            className="mt-4 max-w-xl"
          >
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              rows={3}
              disabled={!ready || pending !== null}
            />
          </Field>
          <div className="mt-4">
            <ConfirmationDialog
              title="Take this listing down?"
              description="It leaves the shop at once. Orders already placed are not affected."
              trigger="Take down listing"
              triggerVariant="danger"
              confirmLabel="Take it down"
              onConfirm={() =>
                void decide('take-down', { reason: reason.trim() })
              }
              danger
              triggerDisabled={!ready || pending !== null || !reason.trim()}
              confirmDisabled={pending !== null}
            />
          </div>
        </Card>
      ) : null}

      {review.reviews.length > 0 ? (
        <Card>
          <h2 className="text-lg font-semibold">Review history</h2>
          <ol className="mt-3 grid gap-2">
            {review.reviews.map((record) => (
              <li key={record.id} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">
                  {record.decision
                    ? formatStatusLabel(record.decision)
                    : 'Waiting for a decision'}
                </p>
                <p className="text-muted">
                  Submitted{' '}
                  {formatIndianDate(record.submittedAt, { includeTime: true })}
                  {record.decidedAt
                    ? `, decided ${formatIndianDate(record.decidedAt, { includeTime: true })}`
                    : ''}
                </p>
                {record.reason ? (
                  <p className="mt-1 break-words">{record.reason}</p>
                ) : null}
              </li>
            ))}
          </ol>
        </Card>
      ) : null}
    </div>
  )
}

function ListingMedia({ review }: { review: ListingReview }) {
  const { product } = review
  return (
    <Card>
      <h2 className="text-lg font-semibold">Photos and video</h2>
      {product.images.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No photos.</p>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {product.images.map((image, index) => (
            <li
              key={image.id}
              className="overflow-hidden rounded-lg border bg-surface-subtle"
            >
              <div className="aspect-square">
                {image.status === 'ready' && image.urls ? (
                  <a href={image.urls.gallery} target="_blank" rel="noreferrer">
                    {/* A resized catalogue size, never the original upload. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image.urls.card}
                      alt={image.alt || product.title}
                      className="h-full w-full object-contain"
                    />
                  </a>
                ) : (
                  <div className="flex h-full items-center justify-center p-3 text-center text-xs text-muted">
                    {image.status === 'failed'
                      ? (image.failureReason ?? 'Failed')
                      : 'Processing'}
                  </div>
                )}
              </div>
              <p className="border-t px-2 py-1 text-xs text-muted">
                {index === 0 ? 'Main photo' : `Photo ${index + 1}`}
              </p>
            </li>
          ))}
        </ul>
      )}
      {product.video ? (
        <div className="mt-4 max-w-xl overflow-hidden rounded-lg border">
          {product.video.status === 'ready' && product.video.urls ? (
            // Sellers upload clips without caption files, and EcoKart makes
            // none, so there is no track to offer.
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              controls
              preload="metadata"
              poster={product.video.urls.poster}
              src={product.video.urls.video}
              className="aspect-video w-full bg-black object-contain"
            />
          ) : (
            <p className="p-4 text-sm text-muted">
              Video{' '}
              {product.video.status === 'failed'
                ? `failed: ${product.video.failureReason ?? 'it could not be used'}`
                : 'is still processing'}
              .
            </p>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">No video.</p>
      )}
    </Card>
  )
}
