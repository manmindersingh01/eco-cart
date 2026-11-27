'use client'

import type { OwnReview } from '@ecokart/core'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, LinkButton } from '@/components/ui/button'
import { Card, Notice, StatusBadge } from '@/components/ui/feedback'
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls'
import { ApiError, apiRequest } from '@/lib/api-client'
import type { CurrentAccount } from '@/lib/auth-routing'

type Values = {
  rating: string
  authorName: string
  title: string
  body: string
}
const empty: Values = { rating: '5', authorName: '', title: '', body: '' }
const valuesOf = (review: OwnReview): Values => ({
  rating: String(review.rating),
  authorName: review.authorName,
  title: review.title ?? '',
  body: review.body ?? '',
})

export function OwnReviewForm({ slug }: { slug: string }) {
  const router = useRouter()
  const lock = useRef(false)
  const [state, setState] = useState<
    'loading' | 'ready' | 'signed-out' | 'forbidden' | 'error'
  >('loading')
  const [own, setOwn] = useState<OwnReview | null>(null)
  const [values, setValues] = useState(empty)
  const [problem, setProblem] = useState('')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const mine = `/api/products/${slug}/reviews/mine`
  const signIn =
    `/sign-in?${new URLSearchParams({ returnTo: `/products/${slug}#your-review` })}` as const

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (signal?.aborted) return
      try {
        const account = await apiRequest<CurrentAccount>('/api/me', {
          signal,
          cache: 'no-store',
        })
        if (signal?.aborted) return
        if (account.role !== 'buyer') {
          setState('forbidden')
          return
        }
        let review: OwnReview | null = null
        try {
          review = (
            await apiRequest<{ review: OwnReview }>(mine, {
              signal,
              cache: 'no-store',
            })
          ).review
        } catch (cause) {
          if (!(cause instanceof ApiError && cause.status === 404)) throw cause
        }
        if (signal?.aborted) return
        setOwn(review)
        setValues(review ? valuesOf(review) : empty)
        setUncertain(false)
        setState('ready')
      } catch (cause) {
        if (signal?.aborted) return
        if (cause instanceof ApiError && cause.status === 401)
          setState('signed-out')
        else {
          setState('error')
          setProblem(
            cause instanceof ApiError
              ? cause.message
              : 'Your review could not be loaded. Try again.',
          )
        }
      }
    },
    [mine],
  )
  useEffect(() => {
    const abort = new AbortController()
    void Promise.resolve().then(() => load(abort.signal))
    return () => abort.abort()
  }, [load])

  function reload() {
    setState('loading')
    setProblem('')
    setSaved(false)
    void load()
  }

  async function save() {
    if (lock.current || uncertain || refreshing) return
    lock.current = true
    setSaving(true)
    setProblem('')
    setSaved(false)
    try {
      const { review } = await apiRequest<{ review: OwnReview }>(
        own ? mine : `/api/products/${slug}/reviews`,
        {
          method: own ? 'PATCH' : 'POST',
          json: { ...values, rating: Number(values.rating) },
        },
      )
      setOwn(review)
      setValues(valuesOf(review))
      setSaved(true)
      startTransition(() => router.refresh())
    } catch (cause) {
      setUncertain(
        !(cause instanceof ApiError) ||
          cause.status >= 500 ||
          cause.status === 409,
      )
      setProblem(
        cause instanceof ApiError
          ? [
              cause.message,
              ...cause.issues.map((issue) =>
                issue.replace(/^authorName\b/, 'Public name'),
              ),
            ].join(' ')
          : 'The result could not be confirmed. Reload your review before trying again.',
      )
    } finally {
      setSaving(false)
      lock.current = false
    }
  }
  return (
    <section
      id="your-review"
      aria-labelledby="own-review-heading"
      className="grid gap-3"
    >
      <h2 id="own-review-heading" className="text-xl font-semibold">
        Your review
      </h2>
      <Card className="grid min-w-0 gap-4">
        {state === 'loading' ? (
          <output>Loading your review...</output>
        ) : state === 'signed-out' ? (
          <div className="grid gap-3">
            <p>Sign in as a buyer to write or edit your review.</p>
            <div>
              <LinkButton href={signIn}>Sign in to review</LinkButton>
            </div>
          </div>
        ) : state === 'forbidden' ? (
          <p>
            Only buyer accounts can write reviews. Use your buyer account to
            continue.
          </p>
        ) : state === 'error' ? (
          <Notice tone="danger" title="Your review could not be loaded">
            <p>{problem}</p>
            <Button className="mt-3" variant="secondary" onClick={reload}>
              Retry loading your review
            </Button>
          </Notice>
        ) : (
          <form
            className="grid gap-4"
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            {own?.status === 'hidden' ? (
              <Notice tone="warning">
                An administrator has hidden your review. You can edit it, but it
                stays hidden until an administrator publishes it again.
              </Notice>
            ) : null}
            {own?.verifiedPurchase ? (
              <div>
                <StatusBadge tone="success">Verified purchase</StatusBadge>
              </div>
            ) : null}
            {saved ? (
              <Notice tone="success">Your review was saved.</Notice>
            ) : null}
            {problem ? (
              <Notice tone="danger" title="Review could not be saved">
                <p>{problem}</p>
                <LinkButton href={signIn} variant="quiet" className="mt-2">
                  Sign in again if your session has ended
                </LinkButton>
              </Notice>
            ) : null}
            <Field label="Rating" htmlFor="review-rating" required>
              <Select
                value={values.rating}
                onChange={(event) =>
                  setValues({ ...values, rating: event.target.value })
                }
                disabled={saving || refreshing || uncertain}
              >
                {[5, 4, 3, 2, 1].map((value) => (
                  <option key={value} value={value}>
                    {value} out of 5
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Public name"
              htmlFor="review-name"
              required
              hint="This name is shown with your review."
            >
              <Input
                value={values.authorName}
                onChange={(event) =>
                  setValues({ ...values, authorName: event.target.value })
                }
                maxLength={50}
                required
                disabled={saving || refreshing || uncertain}
              />
            </Field>
            <Field label="Review title" htmlFor="review-title">
              <Input
                value={values.title}
                onChange={(event) =>
                  setValues({ ...values, title: event.target.value })
                }
                maxLength={100}
                disabled={saving || refreshing || uncertain}
              />
            </Field>
            <Field label="Review text" htmlFor="review-body">
              <Textarea
                value={values.body}
                onChange={(event) =>
                  setValues({ ...values, body: event.target.value })
                }
                maxLength={2000}
                disabled={saving || refreshing || uncertain}
              />
            </Field>
            <div className="flex flex-wrap gap-3">
              <Button
                type="submit"
                disabled={saving || refreshing || uncertain}
              >
                {saving
                  ? 'Saving...'
                  : own
                    ? 'Save review changes'
                    : 'Publish review'}
              </Button>
              <Button
                variant="secondary"
                onClick={reload}
                disabled={saving || refreshing}
              >
                Reload your review
              </Button>
            </div>
          </form>
        )}
      </Card>
    </section>
  )
}
