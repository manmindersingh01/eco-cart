'use client'

import type { PublicReview } from '@ecokart/core'
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ReviewContent } from './review-content'
import { Button } from '@/components/ui/button'
import { Card, Notice } from '@/components/ui/feedback'
import { ApiError, apiRequest } from '@/lib/api-client'
import { useClientReady } from '@/lib/use-client-ready'

type ReviewPage = { items: PublicReview[]; nextCursor: string | null }
export function PublicReviews({
  slug,
  initial,
}: {
  slug: string
  initial: ReviewPage
}) {
  const router = useRouter()
  const ready = useClientReady()
  const lock = useRef(false)
  const [page, setPage] = useState(initial)
  const [pending, setPending] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const [error, setError] = useState('')
  async function load(more: boolean) {
    if (lock.current) return
    lock.current = true
    setPending(true)
    setError('')
    try {
      const query = new URLSearchParams({
        limit: '10',
        ...(more && page.nextCursor ? { cursor: page.nextCursor } : {}),
      })
      const next = await apiRequest<ReviewPage>(
        `/api/products/${slug}/reviews?${query}`,
        { cache: 'no-store' },
      )
      setPage((current) => ({
        ...next,
        items: more
          ? [
              ...current.items,
              ...next.items.filter(
                (item) => !current.items.some((old) => old.id === item.id),
              ),
            ]
          : next.items,
      }))
      if (!more) startTransition(() => router.refresh())
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'Reviews could not be loaded. Check your connection and try again.',
      )
    } finally {
      setPending(false)
      lock.current = false
    }
  }
  return (
    <div className="grid gap-3" aria-label="Published reviews">
      <div>
        <Button
          variant="secondary"
          onClick={() => void load(false)}
          disabled={!ready || pending || refreshing}
        >
          Refresh reviews
        </Button>
      </div>
      {error ? (
        <Notice tone="danger" title="Reviews could not be loaded">
          {error}
        </Notice>
      ) : null}
      {page.items.length ? (
        <ul className="grid gap-3 md:grid-cols-2">
          {page.items.map((review) => (
            <li key={review.id} data-review-id={review.id}>
              <Card className="h-full min-w-0">
                <ReviewContent review={review} />
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No reviews yet.</p>
      )}
      {page.nextCursor ? (
        <div>
          <Button
            onClick={() => void load(true)}
            disabled={!ready || pending || refreshing}
          >
            {pending ? 'Loading reviews...' : 'Load more reviews'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
