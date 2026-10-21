'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { Button, LinkButton } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Card, Notice, StatusBadge } from '@/components/ui/feedback'
import { Field, Select, Textarea } from '@/components/ui/form-controls'
import { apiRequest, ApiError } from '@/lib/api-client'
import { formatStatusLabel } from '@/lib/format'
import { useClientReady } from '@/lib/use-client-ready'
import {
  documentTypeLabel,
  type SellerDocument,
  type DocumentReview,
  type DocumentPage,
} from '@/lib/seller-documents'

export function SellerDocumentRequests({
  sellerId,
  onChange,
}: {
  sellerId: string
  onChange?: () => void
}) {
  const ready = useClientReady()
  const [items, setItems] = useState<SellerDocument[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [type, setType] = useState('gst_certificate')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const url = `/api/admin/sellers/${sellerId}/documents`

  useEffect(() => {
    const controller = new AbortController()
    apiRequest<DocumentPage<SellerDocument>>(url, { signal: controller.signal })
      .then((page) => {
        setItems(page.items)
        setCursor(page.nextCursor)
        return undefined
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : 'Could not load requests.',
          )
      })
    return () => controller.abort()
  }, [url])

  async function request(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      await apiRequest(url, {
        method: 'POST',
        json: { documents: [{ type, note }] },
      })
      const page = await apiRequest<DocumentPage<SellerDocument>>(url)
      setItems(page.items)
      setCursor(page.nextCursor)
      setNote('')
      onChange?.()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not request document.',
      )
    } finally {
      setPending(false)
    }
  }

  async function more() {
    if (!cursor) return
    try {
      const page = await apiRequest<DocumentPage<SellerDocument>>(
        `${url}?cursor=${encodeURIComponent(cursor)}`,
      )
      setItems((current) => [...current, ...page.items])
      setCursor(page.nextCursor)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load more requests.',
      )
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold">
        Verification requests and approval blockers
      </h2>
      <p className="mt-2 text-sm text-muted">
        Every requested, processing or received document blocks approval until
        accepted or cancelled. GSTIN and PAN must also be valid. Files are
        limited to 10 MB.
      </p>
      {error ? (
        <Notice className="mt-3" tone="danger">
          {error}
        </Notice>
      ) : null}
      <ul className="my-4 grid gap-3">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
          >
            <div>
              <p className="font-medium">{documentTypeLabel(item.type)}</p>
              <p className="break-words text-sm">{item.note}</p>
              <StatusBadge>{formatStatusLabel(item.status)}</StatusBadge>
              {['requested', 'processing', 'received'].includes(item.status) ? (
                <p className="text-sm text-muted">Blocks approval</p>
              ) : null}
            </div>
            <LinkButton
              href={{ pathname: `/admin/seller-documents/${item.id}` }}
              variant="secondary"
            >
              Review request
            </LinkButton>
          </li>
        ))}
      </ul>
      {items.length === 0 ? <p>No document requests.</p> : null}
      {cursor ? (
        <Button variant="secondary" onClick={() => void more()}>
          Load more requests
        </Button>
      ) : null}
      <form
        autoComplete="off"
        onSubmit={request}
        className="mt-5 grid gap-4 border-t pt-5"
      >
        <Field label="Document type" htmlFor="request-document-type">
          <Select
            value={type}
            onChange={(event) => setType(event.target.value)}
            disabled={pending || !ready}
          >
            {[
              'gst_certificate',
              'pan_card',
              'bank_proof',
              'business_registration',
              'address_proof',
              'other',
            ].map((value) => (
              <option key={value} value={value}>
                {documentTypeLabel(value)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Document request note"
          htmlFor="request-document-note"
          required
          hint="Tell the applicant exactly what is needed."
        >
          <Textarea
            required
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            disabled={pending || !ready}
          />
        </Field>
        <Button type="submit" disabled={pending || !ready || !note.trim()}>
          {pending ? 'Requesting...' : 'Request document'}
        </Button>
      </form>
    </Card>
  )
}

export function DocumentReviewQueue() {
  const [page, setPage] = useState<DocumentPage<DocumentReview>>({
    items: [],
    nextCursor: null,
  })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const controller = new AbortController()
    apiRequest<DocumentPage<DocumentReview>>('/api/admin/seller-documents', {
      signal: controller.signal,
    })
      .then(setPage)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not load review queue.',
          )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [])
  async function more() {
    try {
      const next = await apiRequest<DocumentPage<DocumentReview>>(
        `/api/admin/seller-documents?cursor=${encodeURIComponent(page.nextCursor!)}`,
      )
      setPage((current) => ({
        items: [...current.items, ...next.items],
        nextCursor: next.nextCursor,
      }))
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load more documents.',
      )
    }
  }
  return (
    <div className="grid gap-4">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {loading ? (
        <output>Loading review queue...</output>
      ) : page.items.length === 0 ? (
        <Card>No documents waiting for review.</Card>
      ) : null}
      {page.items.map((item) => (
        <Card key={item.fileId}>
          <h2 className="font-semibold">{item.seller.displayName}</h2>
          <p className="my-3">{documentTypeLabel(item.request.type)}</p>
          <LinkButton
            href={{ pathname: `/admin/seller-documents/${item.request.id}` }}
            variant="secondary"
          >
            Review document
          </LinkButton>
        </Card>
      ))}
      {page.nextCursor ? (
        <Button variant="secondary" onClick={() => void more()}>
          Load more documents
        </Button>
      ) : null}
    </div>
  )
}

export function DocumentReviewManager({
  initialDocument,
}: {
  initialDocument: SellerDocument
}) {
  const ready = useClientReady()
  const [document, setDocument] = useState(initialDocument)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const url = `/api/admin/seller-documents/${document.id}`
  async function action(name: 'accept' | 'reject' | 'cancel') {
    setPending(true)
    setError(null)
    setSuccess(null)
    try {
      await apiRequest(`${url}/${name}`, {
        method: 'POST',
        ...(name === 'accept' ? {} : { json: { reason } }),
      })
      const current = await apiRequest<{ document: SellerDocument }>(url)
      setDocument(current.document)
      setReason('')
      setSuccess('Document decision saved.')
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not save this decision.',
      )
      if (cause instanceof ApiError && cause.status === 409) {
        const current = await apiRequest<{ document: SellerDocument }>(
          url,
        ).catch(() => null)
        if (current) setDocument(current.document)
      }
    } finally {
      setPending(false)
    }
  }
  const open = !['accepted', 'cancelled'].includes(document.status)
  return (
    <div className="grid gap-5">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {success ? <Notice tone="success">{success}</Notice> : null}
      <Card>
        <h2 className="text-lg font-semibold">
          {documentTypeLabel(document.type)}
        </h2>
        <StatusBadge className="mt-3">
          {formatStatusLabel(document.status)}
        </StatusBadge>
        <p className="mt-3 whitespace-pre-wrap break-words">{document.note}</p>
        {document.cancelReason ? (
          <p>Cancellation reason: {document.cancelReason}</p>
        ) : null}
        <ul className="mt-5 grid gap-4">
          {document.files.map((file, index) => (
            <li key={file.id} className="grid gap-2 rounded-lg border p-3">
              <h3 className="font-medium">
                File {document.files.length - index}:{' '}
                {formatStatusLabel(file.status)}
              </h3>
              {file.failureReason || file.rejectionReason ? (
                <p>{file.failureReason ?? file.rejectionReason}</p>
              ) : null}
              {file.status === 'received' ||
              file.status === 'accepted' ||
              file.status === 'rejected' ? (
                <a
                  className="text-brand underline"
                  href={`${url}/files/${file.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Download checked file {document.files.length - index}{' '}
                  (private, link expires)
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
      {open ? (
        <Card>
          <form autoComplete="off" onSubmit={(event) => event.preventDefault()}>
            <h2 className="text-lg font-semibold">Review decision</h2>
            <p className="mt-2 text-sm text-muted">
              Download and inspect the checked file before accepting. A request
              blocks approval until accepted or cancelled.
            </p>
            <Field
              className="my-4"
              label="Decision reason"
              htmlFor="document-decision-reason"
              hint="Required for rejection or cancellation."
            >
              <Textarea
                value={reason}
                maxLength={500}
                disabled={pending || !ready}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            <div className="flex flex-wrap gap-3">
              {document.status === 'received' ? (
                <>
                  <ConfirmationDialog
                    title="Accept this document?"
                    description="Confirm that you have reviewed the checked file. This clears this request's approval blocker."
                    trigger="Accept document"
                    confirmLabel="Accept document"
                    onConfirm={() => void action('accept')}
                    triggerDisabled={pending || !ready}
                  />
                  <ConfirmationDialog
                    title="Reject this file?"
                    description="The applicant will see the reason and can upload a replacement."
                    trigger="Reject file"
                    confirmLabel="Reject file"
                    onConfirm={() => void action('reject')}
                    triggerDisabled={pending || !ready || !reason.trim()}
                    danger
                  />
                </>
              ) : null}
              <ConfirmationDialog
                title="Cancel this request?"
                description="This removes the request as an approval blocker. The reason is saved for the applicant and audit log."
                trigger="Cancel request"
                confirmLabel="Cancel request"
                onConfirm={() => void action('cancel')}
                triggerDisabled={pending || !ready || !reason.trim()}
                danger
              />
            </div>
          </form>
        </Card>
      ) : null}
      <LinkButton
        href={{ pathname: `/admin/sellers/${document.sellerId}` }}
        variant="secondary"
      >
        Back to seller
      </LinkButton>
    </div>
  )
}
