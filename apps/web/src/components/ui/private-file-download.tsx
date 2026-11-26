'use client'

import { useState } from 'react'
import { Notice } from './feedback'

export function PrivateFileDownload({
  href,
  label,
  unavailableTitle,
  help,
}: {
  href: string
  label: string
  unavailableTitle: string
  help: string
}) {
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
            // Keep the signed storage URL out of client state and page markup.
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
                : 'The file could not be downloaded. Please try again.',
            )
          } catch {
            setError(
              'The file could not be downloaded. Check your connection and try again.',
            )
          } finally {
            setPending(false)
          }
        }}
      >
        {pending ? 'Checking file...' : label}
      </a>
      {error ? (
        <Notice tone="danger" title={unavailableTitle}>
          <p>{error}</p>
          <p>{help}</p>
        </Notice>
      ) : null}
    </div>
  )
}
