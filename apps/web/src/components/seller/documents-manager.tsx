'use client'

import { useEffect, useState } from 'react'
import { Button, LinkButton } from '@/components/ui/button'
import { Card, Notice, StatusBadge } from '@/components/ui/feedback'
import { Field, Input } from '@/components/ui/form-controls'
import { apiRequest, ApiError } from '@/lib/api-client'
import { formatStatusLabel } from '@/lib/format'
import {
  documentTypeLabel,
  documentTypeName,
  documentUploadError,
  type SellerDocument,
  type DocumentPage,
} from '@/lib/seller-documents'

export function DocumentsManager() {
  const [documents, setDocuments] = useState<SellerDocument[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<string | null>(null)
  const [poll, setPoll] = useState(0)
  const [message, setMessage] = useState<string | null>(null)

  async function load(next?: string) {
    const result = await apiRequest<DocumentPage<SellerDocument>>(
      `/api/seller/documents?show=all${next ? `&cursor=${encodeURIComponent(next)}` : ''}`,
    )
    setDocuments((current) =>
      next ? [...current, ...result.items] : result.items,
    )
    setCursor(result.nextCursor)
    setLoading(false)
  }

  useEffect(() => {
    // Let this small read finish: WebKit can report a cancelled fetch as an
    // access-control error during navigation. Ignore any late result instead.
    let active = true
    apiRequest<DocumentPage<SellerDocument>>('/api/seller/documents?show=all')
      .then((result) => {
        if (!active) return undefined
        setDocuments(result.items)
        setCursor(result.nextCursor)
        setLoading(false)
        return undefined
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Documents could not be loaded.',
          )
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [])

  const processing = documents.some(
    (document) => document.status === 'processing',
  )
  useEffect(() => {
    if (!processing || poll >= 60) return undefined
    const controller = new AbortController()
    const timer = setTimeout(() => {
      // Refresh only processing requests so loading more history is preserved.
      Promise.all(
        documents
          .filter((document) => document.status === 'processing')
          .map(async (document) => {
            const result = await apiRequest<{ document: SellerDocument }>(
              `/api/seller/documents/${document.id}`,
              { signal: controller.signal },
            )
            return result.document
          }),
      )
        .then((updated) => {
          setDocuments((current) =>
            current.map(
              (document) =>
                updated.find((item) => item.id === document.id) ?? document,
            ),
          )
          setPoll((current) => current + 1)
          return undefined
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) {
            setError(
              cause instanceof Error
                ? cause.message
                : 'Could not refresh documents.',
            )
            setPoll(60)
          }
        })
    }, 2000)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [documents, processing, poll])

  async function uploadFile(document: SellerDocument, file: File) {
    const invalid = documentUploadError(file)
    setError(invalid)
    if (invalid) return
    setPending(document.id)
    setMessage(null)
    try {
      const sendFile = async () => {
        const { upload } = await apiRequest<{
          upload: {
            key: string
            url: string
            fields: Record<string, string>
            expiresAt: string
          }
        }>(`/api/seller/documents/${document.id}/uploads`, {
          method: 'POST',
          json: { contentType: file.type, size: file.size },
        })
        const form = new FormData()
        for (const [key, value] of Object.entries(upload.fields))
          form.append(key, value)
        form.append('file', file)
        const response = await fetch(upload.url, {
          method: 'POST',
          body: form,
          credentials: 'omit',
        })
        return { response, upload }
      }
      let sent = await sendFile()
      // Renew once on a rejected signed form; never retry registration blindly.
      if (sent.response.status === 403) sent = await sendFile()
      if (!sent.response.ok)
        throw new Error(
          'Storage refused the upload. Choose the file again to obtain a new upload form.',
        )
      const result = await apiRequest<{ document: SellerDocument }>(
        `/api/seller/documents/${document.id}/files`,
        { method: 'POST', json: { uploadKey: sent.upload.key } },
      )
      setDocuments((current) =>
        current.map((item) =>
          item.id === document.id ? result.document : item,
        ),
      )
      setPoll(0)
      setMessage(
        'File uploaded. We are checking it before administrator review.',
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Upload failed. Please try again.',
      )
      if (cause instanceof ApiError && cause.status === 409)
        await load().catch(() => undefined)
    } finally {
      setPending(null)
    }
  }

  return (
    <section className="grid gap-5" aria-label="Verification documents">
      <div>
        <h2 className="text-xl font-semibold">
          Administrator-requested documents
        </h2>
        <p className="mt-2 text-sm text-muted">
          Upload only documents an administrator has requested. PDF, JPEG or
          PNG, up to 10 MB each. Files stay private. Open requests block seller
          approval.
        </p>
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}
      {loading ? (
        <output>Loading documents...</output>
      ) : documents.length === 0 ? (
        <p>No documents have been requested.</p>
      ) : null}
      {documents.map((document) => (
        <Card key={document.id}>
          <h3 className="font-semibold">{documentTypeLabel(document.type)}</h3>
          <StatusBadge className="mt-2">
            {formatStatusLabel(document.status)}
          </StatusBadge>
          <p className="mt-3 whitespace-pre-wrap break-words">
            {document.note}
          </p>
          {document.cancelReason ? (
            <p className="mt-2">Cancellation reason: {document.cancelReason}</p>
          ) : null}
          <ul className="mt-3 grid gap-3">
            {document.files.map((file, index) => (
              <li key={file.id} className="rounded-lg border p-3 text-sm">
                <p>
                  File {document.files.length - index}:{' '}
                  {formatStatusLabel(file.status)}
                </p>
                {file.failureReason || file.rejectionReason ? (
                  <p className="mt-1 text-danger">
                    {file.failureReason ?? file.rejectionReason}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          {document.status === 'requested' ? (
            <Field
              className="mt-4"
              label={`Upload ${documentTypeName(document.type)}`}
              htmlFor={`document-${document.id}`}
              hint="A PDF, JPEG or PNG of up to 10 MB."
            >
              <Input
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                disabled={pending !== null}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) void uploadFile(document, file)
                }}
              />
            </Field>
          ) : null}
          {pending === document.id ? (
            <output className="mt-2">Uploading...</output>
          ) : null}
        </Card>
      ))}
      {processing && poll >= 60 ? (
        <Notice tone="warning">
          The check is taking longer than expected. Refresh to check again. Your
          upload is saved.
        </Notice>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          disabled={pending !== null}
          onClick={() => {
            setPoll(0)
            void load().catch((cause: unknown) =>
              setError(
                cause instanceof Error ? cause.message : 'Refresh failed.',
              ),
            )
          }}
        >
          Refresh documents
        </Button>
        {cursor ? (
          <Button
            variant="secondary"
            onClick={() =>
              void load(cursor).catch((cause: unknown) =>
                setError(
                  cause instanceof Error
                    ? cause.message
                    : 'Could not load more.',
                ),
              )
            }
          >
            Load more documents
          </Button>
        ) : null}
        <LinkButton variant="quiet" href="/">
          Continue shopping
        </LinkButton>
      </div>
    </section>
  )
}
