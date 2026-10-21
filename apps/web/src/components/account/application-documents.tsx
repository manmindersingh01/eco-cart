'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, Notice, Skeleton, StatusBadge } from '@/components/ui/feedback'
import { ApiError, apiRequest } from '@/lib/api-client'
import { formatIndianDate } from '@/lib/format'
import { nextPollDelay, signedUploadBody } from '@/lib/product-editor'
import {
  documentRequestState,
  documentTypeLabel,
  latestFileProblem,
  validateDocumentFile,
  type DocumentRequest,
  type DocumentUpload,
} from '@/lib/seller-application'

const RETURN_TO = '/account/seller-application'

function signInAgain() {
  window.location.assign(
    `/sign-in?returnTo=${encodeURIComponent(RETURN_TO)}&reason=session-ended`,
  )
}

/**
 * The documents an administrator asked the applicant for, through the
 * seller document routes, which accept an applicant for their own
 * business. Files go straight to storage; the worker checks each one.
 */
async function fetchRequests(signal?: AbortSignal) {
  const page = await apiRequest<{ items: DocumentRequest[] }>(
    '/api/seller/documents?show=all&limit=20',
    { signal },
  )
  return page.items
}

/** What to show when loading failed, or null when there is nothing to show. */
function loadFailure(cause: unknown): string | null {
  if (cause instanceof DOMException && cause.name === 'AbortError') return null
  if (cause instanceof ApiError && cause.status === 401) {
    signInAgain()
    return null
  }
  return cause instanceof ApiError
    ? cause.message
    : 'Your documents could not be loaded. Check your connection and try again.'
}

export function ApplicationDocuments() {
  const [requests, setRequests] = useState<DocumentRequest[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setRequests(await fetchRequests())
      setLoadError(null)
    } catch (cause) {
      const message = loadFailure(cause)
      if (message) setLoadError(message)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetchRequests(controller.signal)
      .then((items) => {
        setRequests(items)
        return undefined
      })
      .catch((cause: unknown) => {
        const message = loadFailure(cause)
        if (message) setLoadError(message)
      })
    return () => controller.abort()
  }, [])

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

  function replace(updated: DocumentRequest) {
    setRequests((current) =>
      (current ?? []).map((request) =>
        request.id === updated.id ? updated : request,
      ),
    )
  }

  return (
    <section aria-labelledby="application-documents" className="grid gap-4">
      <div>
        <h2 id="application-documents" className="text-xl font-semibold">
          Documents
        </h2>
        <p className="mt-1 text-sm text-muted">
          If we need proof of your business, the request appears here. Upload a
          PDF, JPEG, or PNG of up to 10 MB.
        </p>
      </div>
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
        <Skeleton className="h-28 w-full" />
      ) : requests.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            We have not asked for any documents. You do not need to do anything
            here unless a request appears.
          </p>
        </Card>
      ) : (
        <ul className="grid gap-3">
          {requests.map((request) => (
            <li key={request.id}>
              <DocumentRequestCard request={request} onChange={replace} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

type Stage = 'idle' | 'uploading' | 'saving'

function DocumentRequestCard({
  request,
  onChange,
}: {
  request: DocumentRequest
  onChange: (request: DocumentRequest) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const state = documentRequestState(request.status)
  const problem = latestFileProblem(request)
  const busy = stage !== 'idle'

  async function upload(file: File) {
    const invalid = validateDocumentFile(file)
    if (invalid) {
      setError(invalid)
      return
    }
    setError(null)
    setStage('uploading')
    try {
      const signed = await apiRequest<{ upload: DocumentUpload }>(
        `/api/seller/documents/${request.id}/uploads`,
        { method: 'POST', json: { contentType: file.type, size: file.size } },
      )
      const stored = await fetch(signed.upload.url, {
        method: 'POST',
        body: signedUploadBody(signed.upload.fields, file),
      })
      if (!stored.ok) {
        throw new Error(`Object storage returned status ${stored.status}`)
      }
      setStage('saving')
      const saved = await apiRequest<{ document: DocumentRequest }>(
        `/api/seller/documents/${request.id}/files`,
        { method: 'POST', json: { uploadKey: signed.upload.key } },
      )
      onChange(saved.document)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        signInAgain()
        return
      }
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'The file could not be uploaded. Check your connection and try again.',
      )
    } finally {
      setStage('idle')
    }
  }

  return (
    <Card className="grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">{documentTypeLabel(request.type)}</h3>
          <p className="mt-1 text-sm text-muted">
            Asked on {formatIndianDate(request.requestedAt)}
          </p>
        </div>
        <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
      </div>
      {request.note ? (
        <p className="text-sm">
          <span className="font-medium">What we need:</span> {request.note}
        </p>
      ) : null}
      {problem ? (
        <Notice tone="danger" title="Please upload it again">
          {problem}
        </Notice>
      ) : null}
      {request.status === 'cancelled' && request.cancelReason ? (
        <p className="text-sm text-muted">{request.cancelReason}</p>
      ) : null}
      {request.status === 'requested' ? (
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void upload(file)
            }}
          />
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {stage === 'uploading'
              ? 'Uploading...'
              : stage === 'saving'
                ? 'Sending...'
                : 'Upload file'}
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </Card>
  )
}
