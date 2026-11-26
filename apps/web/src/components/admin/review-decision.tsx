'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Notice } from '@/components/ui/feedback'
import { ApiError, apiRequest } from '@/lib/api-client'
import { useClientReady } from '@/lib/use-client-ready'

export function ReviewDecision({
  id,
  status,
  author,
}: {
  id: string
  status: 'published' | 'hidden'
  author: string
}) {
  const router = useRouter()
  const ready = useClientReady()
  const lock = useRef(false)
  const [saving, setSaving] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const [problem, setProblem] = useState('')
  const hide = status === 'published'
  const disabled = !ready || saving || refreshing
  async function decide() {
    if (lock.current) return
    lock.current = true
    setSaving(true)
    setProblem('')
    try {
      await apiRequest(`/api/admin/reviews/${id}`, {
        method: 'PATCH',
        json: { status: hide ? 'hidden' : 'published' },
      })
    } catch (cause) {
      setProblem(
        cause instanceof ApiError
          ? cause.message
          : 'The result could not be confirmed. Refresh reviews before trying again.',
      )
    } finally {
      setSaving(false)
      lock.current = false
      startTransition(() => router.refresh())
    }
  }
  return (
    <div className="grid gap-3">
      {problem ? (
        <Notice tone="danger" title="Review could not be updated">
          {problem}
        </Notice>
      ) : null}
      <div>
        <ConfirmationDialog
          title={hide ? 'Hide review?' : 'Publish review again?'}
          description={`${hide ? 'Hide' : 'Publish'} the review by ${author}. ${hide ? 'It will no longer appear publicly or count towards the product’s rating.' : 'It will appear publicly and count towards the product’s rating.'}`}
          trigger={
            saving ? 'Saving...' : hide ? 'Hide review' : 'Publish review again'
          }
          confirmLabel={hide ? 'Hide review' : 'Publish review again'}
          onConfirm={() => void decide()}
          danger={hide}
          triggerVariant={hide ? 'danger' : 'secondary'}
          triggerDisabled={disabled}
          confirmDisabled={disabled}
        />
      </div>
    </div>
  )
}
