'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Card, Notice, StatusBadge } from '@/components/ui/feedback'
import { ApiError, apiRequest } from '@/lib/api-client'
import { formatStatusLabel } from '@/lib/format'
import { hasProcessingMedia, type SellerProduct } from '@/lib/product-editor'

type Action = 'submit' | 'move-to-draft' | 'archive'

/** What each status means for the seller, and what they can do next. */
const STATUS_TEXT: Record<SellerProduct['status'], string> = {
  draft:
    'Not on sale. Submit it for review when the details, prices, stock, and photos are ready.',
  pending_review:
    'EcoKart checks the listing automatically, then an administrator approves or rejects it. Withdraw it to change anything other than prices and stock.',
  approved:
    'On sale. Prices, MRP, stock, and the minimum order change at once; anything else needs the listing back in draft and a new review.',
  rejected: 'Not on sale. Fix what the reason says, then submit it again.',
  archived:
    'Off sale and kept for past orders. Move it back to draft to sell it again.',
}

const tones = {
  draft: 'neutral',
  pending_review: 'warning',
  approved: 'success',
  rejected: 'danger',
  archived: 'neutral',
} as const

export function ProductLifecycle({
  product,
  onProduct,
}: {
  product: SellerProduct
  onProduct: (product: SellerProduct) => void
}) {
  const [pending, setPending] = useState<Action | null>(null)
  const [problem, setProblem] = useState<{
    message: string
    issues: string[]
  } | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const canSubmit = product.status === 'draft' || product.status === 'rejected'
  const mediaBusy = hasProcessingMedia(product)

  async function act(action: Action) {
    setPending(action)
    setProblem(null)
    setDone(null)
    try {
      const response = await apiRequest<{ product: SellerProduct }>(
        `/api/seller/products/${product.id}/${action}`,
        { method: 'POST', json: {} },
      )
      onProduct(response.product)
      setDone(
        action === 'submit'
          ? 'Submitted for review. EcoKart screens it now, and an administrator decides next.'
          : action === 'archive'
            ? 'Archived. The listing left the shop and stays for past orders.'
            : 'Back in draft. Make your changes, then submit it again.',
      )
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        window.location.assign(
          `/sign-in?returnTo=${encodeURIComponent(`/seller/products/${product.id}`)}&reason=session-ended`,
        )
        return
      }
      setProblem(
        cause instanceof ApiError
          ? { message: cause.message, issues: cause.issues }
          : {
              message:
                'The change could not be saved. Check your connection and try again.',
              issues: [],
            },
      )
    } finally {
      setPending(null)
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Listing status</h2>
          <p className="mt-1 max-w-prose text-sm text-muted">
            {STATUS_TEXT[product.status]}
          </p>
        </div>
        <StatusBadge tone={tones[product.status]}>
          {formatStatusLabel(product.status)}
        </StatusBadge>
      </div>

      {product.status === 'rejected' && product.rejectionReason ? (
        <Notice className="mt-4" tone="danger" title="Why it was rejected">
          {product.rejectionReason}
        </Notice>
      ) : null}
      {done ? (
        <Notice className="mt-4" tone="success">
          {done}
        </Notice>
      ) : null}
      {problem ? (
        <Notice className="mt-4" tone="danger" title={problem.message}>
          {problem.issues.length > 0 ? (
            <ul className="mt-2 list-disc pl-5">
              {problem.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </Notice>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {canSubmit ? (
          <Button
            onClick={() => void act('submit')}
            disabled={pending !== null || mediaBusy}
          >
            {pending === 'submit' ? 'Submitting...' : 'Submit for review'}
          </Button>
        ) : null}
        {product.status === 'pending_review' ? (
          <Button
            variant="secondary"
            onClick={() => void act('move-to-draft')}
            disabled={pending !== null}
          >
            {pending === 'move-to-draft'
              ? 'Withdrawing...'
              : 'Withdraw to draft'}
          </Button>
        ) : null}
        {product.status === 'approved' ? (
          <>
            <ConfirmationDialog
              title="Move this listing back to draft?"
              description="It leaves the shop until an administrator approves it again. Use this to change the title, photos, or other details."
              trigger="Move back to draft"
              triggerVariant="secondary"
              confirmLabel="Move back to draft"
              onConfirm={() => void act('move-to-draft')}
              triggerDisabled={pending !== null}
              confirmDisabled={pending !== null}
            />
            <ConfirmationDialog
              title="Archive this listing?"
              description="It leaves the shop and stays for past orders. You can move it back to draft later to sell it again."
              trigger="Archive"
              triggerVariant="danger"
              confirmLabel="Archive listing"
              onConfirm={() => void act('archive')}
              danger
              triggerDisabled={pending !== null}
              confirmDisabled={pending !== null}
            />
          </>
        ) : null}
        {product.status === 'archived' ? (
          <Button
            variant="secondary"
            onClick={() => void act('move-to-draft')}
            disabled={pending !== null}
          >
            {pending === 'move-to-draft' ? 'Moving...' : 'Move back to draft'}
          </Button>
        ) : null}
      </div>
      {canSubmit && mediaBusy ? (
        <p className="mt-3 text-sm text-muted">
          Submit once every photo and the video have finished processing.
        </p>
      ) : null}
    </Card>
  )
}
