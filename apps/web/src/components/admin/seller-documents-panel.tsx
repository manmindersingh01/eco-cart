'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card, Notice, Skeleton, StatusBadge } from '@/components/ui/feedback'
import { Field, Input, Select } from '@/components/ui/form-controls'
import { ApiError, apiRequest } from '@/lib/api-client'
import { formatIndianDate } from '@/lib/format'
import { nextPollDelay } from '@/lib/product-editor'
import {
  DOCUMENT_TYPES,
  documentTypeLabel,
  type DocumentFile,
  type DocumentRequest,
  type DocumentRequestStatus,
} from '@/lib/seller-application'

const REQUEST_STATES: Record<
  DocumentRequestStatus,
  { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }
> = {
  requested: { label: 'Waiting for seller', tone: 'warning' },
  processing: { label: 'Checking file', tone: 'neutral' },
  received: { label: 'Ready to review', tone: 'warning' },
  accepted: { label: 'Accepted', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

const FILE_STATES: Record<DocumentFile['status'], string> = {
  processing: 'Checking',
  received: 'Ready to review',
  failed: 'Could not be read',
  accepted: 'Accepted',
  rejected: 'Rejected',
}

function fileSize(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function fetchRequests(sellerId: string, signal?: AbortSignal) {
  const page = await apiRequest<{ items: DocumentRequest[] }>(
    `/api/admin/sellers/${sellerId}/documents?limit=20`,
    { signal },
  )
  return page.items
}

/** What to show when loading failed, or null when there is nothing to show. */
function loadFailure(cause: unknown): string | null {
  if (cause instanceof DOMException && cause.name === 'AbortError') return null
  return cause instanceof ApiError
    ? cause.message
    : 'The documents could not be loaded. Check your connection and try again.'
}

/**
 * The documents asked of one seller: asking for a new one, and reviewing
 * what the seller uploaded. A seller is approved only once every request
 * is accepted or cancelled.
 */
export function SellerDocumentsPanel({ sellerId }: { sellerId: string }) {
  const [requests, setRequests] = useState<DocumentRequest[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [type, setType] = useState<string>(DOCUMENT_TYPES[0].value)
  const [note, setNote] = useState('')
  const [asking, setAsking] = useState(false)
  const [askError, setAskError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setRequests(await fetchRequests(sellerId))
      setLoadError(null)
    } catch (cause) {
      const message = loadFailure(cause)
      if (message) setLoadError(message)
    }
  }, [sellerId])

  useEffect(() => {
    const controller = new AbortController()
    fetchRequests(sellerId, controller.signal)
      .then((items) => {
        setRequests(items)
        return undefined
      })
      .catch((cause: unknown) => {
        const message = loadFailure(cause)
        if (message) setLoadError(message)
      })
    return () => controller.abort()
  }, [sellerId])

  // While the worker checks a file, look again with a growing delay.
  const checking =
    requests?.some((request) => request.status === 'processing') ?? false
  useEffect(() => {
    if (!checking) return undefined
    let attempt = 0
    let timer = 0
    let active = true
    const poll = () => {
      timer = window.setTimeout(() => {
        attempt += 1
        void load().then(() => {
          if (active) poll()
          return undefined
        })
      }, nextPollDelay(attempt))
    }
    poll()
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [checking, load])

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAsking(true)
    setAskError(null)
    try {
      await apiRequest(`/api/admin/sellers/${sellerId}/documents`, {
        method: 'POST',
        json: { documents: [{ type, note: note.trim() }] },
      })
      setNote('')
      await load()
    } catch (cause) {
      setAskError(
        cause instanceof ApiError
          ? [cause.message, ...cause.issues].join('. ')
          : 'The request could not be sent. Check your connection and try again.',
      )
    } finally {
      setAsking(false)
    }
  }

  return (
    <Card flush>
      <div className="border-b p-5 sm:p-6">
        <h2 className="text-lg font-semibold">Documents</h2>
        <p className="mt-1 text-sm text-muted">
          Ask the seller for proof of their business; they see each request in
          their account. Approval waits until every request is accepted or
          cancelled.
        </p>
      </div>

      <form
        onSubmit={ask}
        className="grid gap-4 border-b p-5 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] sm:items-end sm:p-6"
      >
        <Field label="Document" htmlFor="document-type">
          <Select
            value={type}
            onChange={(event) => setType(event.target.value)}
            disabled={asking}
          >
            {DOCUMENT_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note for the seller" htmlFor="document-note" required>
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            placeholder="For example: a clear copy of all pages"
            disabled={asking}
          />
        </Field>
        <Button type="submit" disabled={asking || !note.trim()}>
          {asking ? 'Asking...' : 'Ask for document'}
        </Button>
        {askError ? (
          <p
            role="alert"
            className="text-sm font-medium text-danger sm:col-span-3"
          >
            {askError}
          </p>
        ) : null}
      </form>

      <div className="p-5 sm:p-6">
        {loadError ? (
          <Notice tone="danger" title="Documents unavailable">
            <p>{loadError}</p>
            <Button
              variant="secondary"
              className="mt-3"
              onClick={() => void load()}
            >
              Try again
            </Button>
          </Notice>
        ) : requests === null ? (
          <Skeleton className="h-24 w-full" />
        ) : requests.length === 0 ? (
          <p className="text-sm text-muted">
            No documents have been asked for.
          </p>
        ) : (
          <ul className="grid gap-4">
            {requests.map((request) => (
              <li key={request.id}>
                <DocumentReview request={request} onChange={() => load()} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

function DocumentReview({
  request,
  onChange,
}: {
  request: DocumentRequest
  onChange: () => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const state = REQUEST_STATES[request.status]
  const open =
    request.status === 'requested' ||
    request.status === 'processing' ||
    request.status === 'received'
  const reviewing = request.status === 'received'

  async function act(action: 'accept' | 'reject' | 'cancel') {
    setPending(true)
    setError(null)
    try {
      await apiRequest(`/api/admin/seller-documents/${request.id}/${action}`, {
        method: 'POST',
        ...(action === 'accept' ? {} : { json: { reason: reason.trim() } }),
      })
      setReason('')
      await onChange()
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'That did not work. Check your connection and try again.',
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <article className="rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">{documentTypeLabel(request.type)}</h3>
          <p className="mt-1 text-sm text-muted">
            Asked on{' '}
            {formatIndianDate(request.requestedAt, { includeTime: true })}
          </p>
        </div>
        <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
      </div>
      <p className="mt-3 text-sm">
        <span className="font-medium">Note:</span> {request.note}
      </p>
      {request.status === 'cancelled' && request.cancelReason ? (
        <p className="mt-2 text-sm text-muted">
          Cancelled: {request.cancelReason}
        </p>
      ) : null}

      {request.files.length > 0 ? (
        <ul className="mt-4 grid gap-2 border-t pt-4 text-sm">
          {request.files.map((file) => (
            <li
              key={file.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
            >
              <span className="min-w-0">
                <span className="font-medium">{FILE_STATES[file.status]}</span>
                <span className="text-muted">
                  {' '}
                  · uploaded{' '}
                  {formatIndianDate(file.uploadedAt, { includeTime: true })}
                  {file.sizeBytes ? ` · ${fileSize(file.sizeBytes)}` : ''}
                </span>
                {file.failureReason || file.rejectionReason ? (
                  <span className="block text-danger">
                    {file.failureReason ?? file.rejectionReason}
                  </span>
                ) : null}
              </span>
              {file.status !== 'processing' && file.status !== 'failed' ? (
                <a
                  href={`/api/admin/seller-documents/${request.id}/files/${file.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-brand-strong underline-offset-4 hover:underline"
                >
                  Open file
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {open ? (
        <div className="mt-4 grid gap-3 border-t pt-4">
          <Field
            label="Reason"
            htmlFor={`document-reason-${request.id}`}
            hint={
              reviewing
                ? 'Needed to reject the file or cancel the request. The seller sees it.'
                : 'Needed to cancel the request. The seller sees it.'
            }
          >
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              disabled={pending}
            />
          </Field>
          <div className="flex flex-wrap gap-3">
            {reviewing ? (
              <>
                <Button disabled={pending} onClick={() => void act('accept')}>
                  Accept file
                </Button>
                <Button
                  variant="danger"
                  disabled={pending || !reason.trim()}
                  onClick={() => void act('reject')}
                >
                  Reject file
                </Button>
              </>
            ) : null}
            <Button
              variant="secondary"
              disabled={pending || !reason.trim()}
              onClick={() => void act('cancel')}
            >
              Cancel request
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
