'use client'

import { useState } from 'react'
import { Notice } from '@/components/ui/feedback'

export function InvoiceDownload({
  id,
  area = 'seller',
}: {
  id: string
  area?: 'seller' | 'admin'
}) {
  const href = `/api/invoices/${id}/pdf${area === 'seller' ? '?as=seller' : ''}`
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="grid gap-2">
      <a
        href={href}
        aria-disabled={pending}
        className="inline-flex min-h-11 items-center font-semibold text-brand-strong underline-offset-4 hover:underline"
        onClick={async (event) => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
            return
          event.preventDefault()
          if (pending) return
          setPending(true)
          setError(null)
          try {
            // Check failures without fetching or retaining the private signed URL.
            // The ordinary link then follows a fresh redirect to the PDF.
            const response = await fetch(href, {
              redirect: 'manual',
              cache: 'no-store',
            })
            if (response.type === 'opaqueredirect') {
              window.location.assign(href)
              return
            }
            const body: unknown = await response.json()
            setError(
              typeof body === 'object' &&
                body !== null &&
                'error' in body &&
                typeof body.error === 'string'
                ? body.error
                : 'The invoice could not be downloaded. Please try again.',
            )
          } catch {
            setError(
              'The invoice could not be downloaded. Check your connection and try again.',
            )
          } finally {
            setPending(false)
          }
        }}
      >
        {pending ? 'Checking invoice…' : 'Download PDF'}
      </a>
      {error ? (
        <Notice tone="danger" title="Invoice unavailable">
          <p>{error}</p>
          <p>
            Refresh the order and try again. If it is still unavailable, contact
            an administrator.
          </p>
        </Notice>
      ) : null}
    </div>
  )
}
