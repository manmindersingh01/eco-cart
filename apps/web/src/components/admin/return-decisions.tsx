'use client'

import type { ReturnStatus } from '@ecokart/core'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Card, Notice } from '@/components/ui/feedback'
import { Field, Textarea } from '@/components/ui/form-controls'
import { ApiError, apiRequest } from '@/lib/api-client'

export function ReturnDecisions({
  returnId,
  status,
}: {
  returnId: string
  status: ReturnStatus
}) {
  const router = useRouter()
  const lock = useRef(false)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const [problem, setProblem] = useState<{
    message: string
    issues: string[]
  } | null>(null)
  const [success, setSuccess] = useState('')
  const pending = saving || refreshing
  const canApprove = status === 'requested'
  const canReject = status === 'requested' || status === 'approved'

  async function decide(action: 'approve' | 'reject') {
    if (lock.current || pending || (action === 'reject' && !note.trim())) return
    lock.current = true
    setSaving(true)
    setProblem(null)
    setSuccess('')
    try {
      await apiRequest(`/api/admin/returns/${returnId}/${action}`, {
        method: 'POST',
        json: note.trim() ? { note: note.trim() } : {},
      })
      setNote('')
      setSuccess(
        action === 'approve'
          ? 'Return approved. No refund has been made by this action.'
          : 'Return rejected. The decision note is visible to the buyer and seller.',
      )
    } catch (cause) {
      setProblem(
        cause instanceof ApiError
          ? { message: cause.message, issues: cause.issues }
          : {
              message:
                'The result could not be confirmed. Check the refreshed return before trying again.',
              issues: [],
            },
      )
    } finally {
      startTransition(() => router.refresh())
      setSaving(false)
      lock.current = false
    }
  }
  return (
    <Card className="grid gap-3" aria-label="Return decision controls">
      <h2 className="text-lg font-semibold">Review decision</h2>
      {problem ? (
        <Notice tone="danger" title={problem.message}>
          {problem.issues.length ? (
            <ul>
              {problem.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </Notice>
      ) : null}
      {success ? <Notice tone="success" title={success} /> : null}
      {canReject ? (
        <>
          <Field
            label="Decision note"
            htmlFor="decision-note"
            hint="Optional for approval. Required for rejection. The buyer and seller can read this note."
          >
            <Textarea
              id="decision-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={1000}
              disabled={pending}
            />
          </Field>
          <div className="flex flex-wrap gap-3">
            {canApprove ? (
              <ConfirmationDialog
                title="Approve this return?"
                description={`The buyer and seller will see the approval. This does not issue or record a refund.${note.trim() ? ` Note: ${note.trim()}` : ' No decision note will be added.'}`}
                trigger={pending ? 'Saving...' : 'Approve return'}
                confirmLabel="Confirm approval"
                triggerDisabled={pending}
                confirmDisabled={pending || !canApprove}
                onConfirm={() => void decide('approve')}
              />
            ) : null}
            <ConfirmationDialog
              title="Reject this return?"
              description={`The buyer and seller will see the rejection and this reason: ${note.trim()}`}
              trigger={pending ? 'Saving...' : 'Reject return'}
              confirmLabel="Confirm rejection"
              danger
              triggerDisabled={pending || !note.trim()}
              confirmDisabled={pending || !canReject || !note.trim()}
              onConfirm={() => void decide('reject')}
            />
          </div>
        </>
      ) : (
        <p className="text-sm text-muted">
          This return is closed to review decisions.
        </p>
      )}
    </Card>
  )
}
