'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Notice } from '@/components/ui/feedback'
import { Field, Input } from '@/components/ui/form-controls'
import { ApiError, apiRequest } from '@/lib/api-client'
import { useClientReady } from '@/lib/use-client-ready'

export function BankAccountForm({
  sellerId,
  last4,
}: {
  sellerId: string
  last4?: string
}) {
  const router = useRouter()
  const ready = useClientReady()
  const lock = useRef(false)
  const [saving, setSaving] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const [accountHolder, setHolder] = useState('')
  const [accountNumber, setNumber] = useState('')
  const [ifsc, setIfsc] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const [success, setSuccess] = useState(false)
  const disabled = !ready || saving || refreshing
  const digits = accountNumber.replaceAll(/[\s-]/g, '')

  async function save() {
    if (lock.current) return
    lock.current = true
    setSaving(true)
    setError(null)
    setIssues([])
    setSuccess(false)
    try {
      await apiRequest(`/api/admin/sellers/${sellerId}/bank-account`, {
        method: 'PUT',
        json: { accountHolder, accountNumber, ifsc },
      })
      setHolder('')
      setNumber('')
      setIfsc('')
      setSuccess(true)
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'The save could not be confirmed. Refresh the saved bank summary before trying again.',
      )
      setIssues(cause instanceof ApiError ? cause.issues : [])
      // Do not keep sensitive input around after an unsuccessful request either.
      setNumber('')
    } finally {
      setSaving(false)
      lock.current = false
      startTransition(() => router.refresh())
    }
  }

  return (
    <form
      autoComplete="off"
      onSubmit={(event) => event.preventDefault()}
      className="grid gap-4"
    >
      <h3 className="font-semibold">
        {last4 ? 'Replace bank account' : 'Add bank account'}
      </h3>
      <p className="text-sm text-muted">
        Enter all details from the seller’s bank document. Saved account numbers
        cannot be retrieved here.
      </p>
      {success ? (
        <Notice tone="success">
          Bank account saved. The entry fields have been cleared.
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="danger" title={error}>
          {issues.length ? (
            <ul className="list-disc pl-5">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </Notice>
      ) : null}
      <Field label="Account holder" htmlFor="bank-holder" required>
        <Input
          value={accountHolder}
          onChange={(event) => setHolder(event.target.value)}
          maxLength={100}
          disabled={disabled}
        />
      </Field>
      <Field
        label="Full account number"
        htmlFor="bank-number"
        required
        hint="9 to 18 digits. This field is hidden while you type and cleared after a save attempt."
      >
        <Input
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          value={accountNumber}
          onChange={(event) => setNumber(event.target.value)}
          maxLength={40}
          disabled={disabled}
        />
      </Field>
      <Field
        label="Bank IFSC"
        htmlFor="bank-ifsc"
        required
        hint="11 characters, for example HDFC0001234."
      >
        <Input
          value={ifsc}
          onChange={(event) => setIfsc(event.target.value)}
          maxLength={11}
          disabled={disabled}
          autoCapitalize="characters"
        />
      </Field>
      <div>
        <ConfirmationDialog
          title={last4 ? 'Replace saved bank account?' : 'Save bank account?'}
          description={`${last4 ? `Replace the account ending ${last4}. ` : ''}Save ${accountHolder.trim()} with account ending ${digits.slice(-4)} and IFSC ${ifsc.trim().toUpperCase()}. Check these details against the seller’s bank document.`}
          trigger={saving ? 'Saving...' : 'Review bank details'}
          confirmLabel="Save bank account"
          onConfirm={() => void save()}
          triggerDisabled={
            disabled || !accountHolder.trim() || !digits || !ifsc.trim()
          }
          confirmDisabled={disabled}
        />
      </div>
    </form>
  )
}
