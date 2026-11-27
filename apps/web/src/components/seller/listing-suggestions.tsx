'use client'

import type { ListingDraftView, ListingSuggestion } from '@ecokart/core'
import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, Notice } from '@/components/ui/feedback'
import { apiRequest, ApiError } from '@/lib/api-client'
import { useClientReady } from '@/lib/use-client-ready'
import type { JsonDates } from '@/lib/catalogue-operations'
import type { ListingFormValues } from '@/lib/product-editor'
import {
  listingSuggestionFields,
  type SuggestionField,
} from '@/lib/seller-suggestions'

const labels: Record<SuggestionField, string> = {
  title: 'Title',
  description: 'Description',
  highlights: 'Highlights',
  attributes: 'Attributes',
}
export function ListingSuggestions({
  productId,
  hasPhoto,
  current,
  disabled,
  onApply,
}: {
  productId: string
  hasPhoto: boolean
  current: ListingFormValues
  disabled: boolean
  onApply: (
    suggestion: ListingSuggestion,
    selected: Partial<Record<SuggestionField, boolean>>,
  ) => void
}) {
  const id = useId()
  const ready = useClientReady()
  const write = useRef<AbortController | null>(null)
  const [draft, setDraft] = useState<JsonDates<ListingDraftView> | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [paused, setPaused] = useState(false)
  const [problem, setProblem] = useState('')
  const [selected, setSelected] = useState<
    Partial<Record<SuggestionField, boolean>>
  >({})
  const [copied, setCopied] = useState(false)
  const pending = draft?.status === 'queued' || draft?.status === 'running'
  const draftId = draft?.id
  useEffect(() => () => write.current?.abort(), [])
  useEffect(() => {
    if (!draftId || !pending || paused) return undefined
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let attempts = 0
    async function poll() {
      try {
        const result = await apiRequest<{ draft: JsonDates<ListingDraftView> }>(
          `/api/seller/listing-drafts/${draftId}`,
          {
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(10000),
            ]),
            cache: 'no-store',
          },
        )
        if (controller.signal.aborted) return
        setDraft(result.draft)
        if (!['queued', 'running'].includes(result.draft.status)) return
        if (++attempts >= 120) {
          setPaused(true)
          return
        }
        timer = setTimeout(() => void poll(), 2000)
      } catch {
        if (!controller.signal.aborted) {
          setProblem(
            'The suggestion status could not be checked. Your form is unchanged.',
          )
          setPaused(true)
        }
      }
    }
    timer = setTimeout(() => void poll(), 1000)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [draftId, pending, paused])
  async function request() {
    if (write.current || disabled || pending || !hasPhoto) return
    const controller = new AbortController()
    write.current = controller
    setRequesting(true)
    setProblem('')
    setSelected({})
    setCopied(false)
    setPaused(false)
    try {
      const result = await apiRequest<{ draft: JsonDates<ListingDraftView> }>(
        '/api/seller/listing-drafts',
        {
          method: 'POST',
          json: { productId },
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15000),
          ]),
        },
      )
      if (!controller.signal.aborted) setDraft(result.draft)
    } catch (cause) {
      if (!controller.signal.aborted)
        setProblem(
          cause instanceof ApiError && cause.status === 429
            ? 'The suggestion limit is reached. Try later or keep editing manually.'
            : cause instanceof ApiError && cause.status === 503
              ? 'AI listing suggestions are unavailable. You can keep editing manually.'
              : 'Suggestions could not be requested. Your form is unchanged; try later or keep editing manually.',
        )
    } finally {
      if (write.current === controller) {
        write.current = null
        setRequesting(false)
      }
    }
  }
  return (
    <section aria-label="AI listing suggestions">
      <Card className="grid min-w-0 gap-4">
        <h2 className="text-lg font-semibold">AI listing suggestions</h2>
        <p className="text-sm text-muted">
          Use a ready product photo to request suggestions. Review each field,
          choose what to copy, then use Save listing details. Nothing is saved
          or published automatically.
        </p>
        {!hasPhoto ? (
          <p className="text-sm">
            Add a photo and wait until it is ready before requesting
            suggestions.
          </p>
        ) : null}
        <div>
          <Button
            variant="secondary"
            disabled={!ready || disabled || requesting || pending || !hasPhoto}
            onClick={() => void request()}
          >
            {requesting
              ? 'Requesting suggestions...'
              : 'Request listing suggestions'}
          </Button>
        </div>
        {problem ? (
          <Notice tone="warning" title="Suggestions unavailable">
            {problem}
          </Notice>
        ) : null}
        {pending ? (
          <output className="text-sm">
            Listing suggestions: {draft.status}. You can continue editing the
            form.
          </output>
        ) : null}
        {paused && pending ? (
          <Notice title="Automatic checks paused">
            <p>
              The request is taking longer or could not be checked. Your manual
              edits are safe.
            </p>
            <Button
              className="mt-3"
              variant="secondary"
              onClick={() => {
                setProblem('')
                setPaused(false)
              }}
            >
              Check suggestions again
            </Button>
          </Notice>
        ) : null}
        {draft?.status === 'failed' ? (
          <Notice tone="warning" title="Suggestions could not be made">
            Try again later or continue with the manual listing form.
          </Notice>
        ) : null}
        {draft?.status === 'succeeded' && draft.suggestion ? (
          <>
            <p className="text-sm">
              These are AI suggestions. Check every claim against your product.
            </p>
            <div className="grid min-w-0 gap-4">
              {listingSuggestionFields.map((field) => (
                <section key={field} className="min-w-0 rounded-lg border p-4">
                  <h3 className="font-semibold">{labels[field]}</h3>
                  <dl className="mt-3 grid min-w-0 gap-4 md:grid-cols-2">
                    <div className="min-w-0">
                      <dt className="text-sm text-muted">Current form value</dt>
                      <dd className="mt-1 whitespace-pre-wrap break-words">
                        {currentText(current, field) || 'Empty'}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-sm text-muted">AI suggestion</dt>
                      <dd className="mt-1 whitespace-pre-wrap break-words">
                        {suggestionText(draft.suggestion!, field) || 'Empty'}
                      </dd>
                    </div>
                  </dl>
                  <label
                    htmlFor={`${id}-${field}`}
                    className="mt-3 flex min-h-11 items-center gap-3 text-sm"
                  >
                    <input
                      id={`${id}-${field}`}
                      type="checkbox"
                      className="size-5 accent-brand"
                      checked={Boolean(selected[field])}
                      disabled={disabled}
                      onChange={(event) =>
                        setSelected((old) => ({
                          ...old,
                          [field]: event.target.checked,
                        }))
                      }
                    />
                    Use suggested {labels[field]}
                  </label>
                </section>
              ))}
            </div>
            <div>
              <Button
                disabled={disabled || !Object.values(selected).some(Boolean)}
                onClick={() => {
                  onApply(draft.suggestion!, selected)
                  setSelected({})
                  setCopied(true)
                }}
              >
                Copy selected suggestions to form
              </Button>
            </div>
          </>
        ) : null}
        {copied ? (
          <Notice tone="success">
            Selected suggestions were copied to the form. Review them, then Save
            listing details. Nothing has been saved yet.
          </Notice>
        ) : null}
      </Card>
    </section>
  )
}
function currentText(
  values: ListingFormValues,
  field: SuggestionField,
): string {
  if (field === 'highlights') return values.highlights.join('\n')
  if (field === 'attributes')
    return values.attributes
      .map(({ name, value }) => `${name}: ${value}`)
      .join('\n')
  return values[field]
}
function suggestionText(
  values: ListingSuggestion,
  field: SuggestionField,
): string {
  if (field === 'highlights') return values.highlights.join('\n')
  if (field === 'attributes')
    return Object.entries(values.attributes)
      .map(([name, value]) => `${name}: ${value}`)
      .join('\n')
  return values[field]
}
