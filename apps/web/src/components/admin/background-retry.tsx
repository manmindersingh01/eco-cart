'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Notice } from '@/components/ui/feedback'
import { apiRequest, ApiError } from '@/lib/api-client'
import { useClientReady } from '@/lib/use-client-ready'
import { Button } from '@/components/ui/button'

export function BackgroundRetry({
  endpoint,
  label,
}: {
  endpoint: string
  label: string
}) {
  const ready = useClientReady()
  const router = useRouter()
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const [message, setMessage] = useState('')
  const [uncertain, setUncertain] = useState(false)
  return (
    <div className="grid gap-3">
      {message ? (
        <Notice tone="danger" title="Retry could not be confirmed">
          {message}
          {uncertain ? (
            <Button
              className="mt-3"
              variant="secondary"
              onClick={() => window.location.reload()}
            >
              Reload current state
            </Button>
          ) : null}
        </Notice>
      ) : null}
      <div>
        <ConfirmationDialog
          title="Retry background work?"
          description={`Give ${label} another attempt. The worker will process it using the existing rules.`}
          trigger="Retry"
          confirmLabel="Confirm retry"
          triggerDisabled={!ready || busy || refreshing || uncertain}
          confirmDisabled={busy || refreshing}
          onConfirm={() => {
            if (lock.current || uncertain) return
            lock.current = true
            setBusy(true)
            setMessage('')
            void apiRequest(endpoint, { method: 'POST' })
              .catch((cause: unknown) => {
                const unknownResult =
                  !(cause instanceof ApiError) || cause.status >= 500
                setUncertain(unknownResult)
                setMessage(
                  unknownResult
                    ? 'Refresh this list to check the current state before trying again.'
                    : 'The item may have changed or may not be eligible. Refresh this list to check its current state.',
                )
              })
              .finally(() => {
                lock.current = false
                setBusy(false)
                startTransition(() => router.refresh())
              })
          }}
        />
      </div>
    </div>
  )
}
