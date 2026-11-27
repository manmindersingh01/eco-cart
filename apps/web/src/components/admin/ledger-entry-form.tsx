'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Card, Notice } from '@/components/ui/feedback'
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls'
import { parseRupeesToPaise } from '@/lib/admin-settings'
import { ApiError, apiRequest } from '@/lib/api-client'
import { formatInr } from '@/lib/format'
import { useClientReady } from '@/lib/use-client-ready'

export function LedgerEntryForm({
  sellerId,
  kind,
  bank,
  balancePaise,
}: {
  sellerId: string
  kind: 'payout' | 'adjustment'
  bank: { accountNumberLast4: string; ifsc: string } | null
  balancePaise: number
}) {
  const payout = kind === 'payout'
  const ready = useClientReady()
  const router = useRouter()
  const lock = useRef(false)
  const [amount, setAmount] = useState('')
  const [detail, setDetail] = useState('')
  const [direction, setDirection] = useState('increase')
  const [saving, setSaving] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const [problem, setProblem] = useState('')
  const [success, setSuccess] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const parsed = parseRupeesToPaise(amount)
  const positive = parsed.ok && parsed.value > 0
  const amountPaise = parsed.ok
    ? parsed.value * (!payout && direction === 'reduce' ? -1 : 1)
    : 0
  const disabled = !ready || saving || refreshing || uncertain
  const unavailable = payout && (!bank || balancePaise <= 0)
  const amountError = amount
    ? !parsed.ok
      ? parsed.error
      : !positive
        ? 'Enter an amount greater than zero.'
        : undefined
    : undefined
  const signedAmount = `${amountPaise > 0 && !payout ? '+' : ''}${formatInr(amountPaise)}`

  async function record() {
    if (lock.current || disabled || unavailable || !positive || !detail.trim())
      return
    lock.current = true
    setSaving(true)
    setProblem('')
    setSuccess('')
    try {
      const result = await apiRequest<{ balancePaise: number }>(
        `/api/admin/sellers/${sellerId}/${payout ? 'payouts' : 'adjustments'}`,
        {
          method: 'POST',
          json: {
            amountPaise,
            ...(payout
              ? { reference: detail.trim() }
              : { reason: detail.trim() }),
          },
        },
      )
      setAmount('')
      setDetail('')
      setSuccess(
        `${payout ? 'Payout' : 'Adjustment'} recorded. Balance after this entry: ${formatInr(result.balancePaise)}. Refresh or show the latest money entries to review it.`,
      )
    } catch (cause) {
      const ambiguous = !(cause instanceof ApiError) || cause.status >= 500
      setUncertain(ambiguous)
      setProblem(
        ambiguous
          ? 'The result could not be confirmed. Reload and check money history before recording this entry again.'
          : [
              cause.message,
              ...cause.issues.map((issue) =>
                issue
                  .replace(/^amountPaise\b/, 'Amount')
                  .replace(/^reference\b/, 'Transfer reference')
                  .replace(/^reason\b/, 'Reason'),
              ),
            ].join(' '),
      )
    } finally {
      setSaving(false)
      lock.current = false
      startTransition(() => router.refresh())
    }
  }

  return (
    <Card className="min-w-0">
      <form
        autoComplete="off"
        aria-label={
          payout ? 'Record an external payout' : 'Record a balance adjustment'
        }
        className="grid gap-4"
        onSubmit={(event) => event.preventDefault()}
      >
        <h3 className="font-semibold">
          {payout ? 'Record an external payout' : 'Record a balance adjustment'}
        </h3>
        <p className="text-sm text-muted">
          {payout
            ? 'Record a bank transfer already completed outside EcoKart. This form does not send money.'
            : 'Add a correction with a reason the seller can see. Increase adds to what EcoKart owes; reduce takes money back.'}{' '}
          Entries cannot be edited or deleted. Correct a mistake with a new
          adjustment.
        </p>
        {unavailable ? (
          <Notice tone="warning">
            {!bank
              ? 'Add the seller’s bank account before recording a payout.'
              : 'A payout can only be recorded when the seller has a positive balance.'}
          </Notice>
        ) : null}
        {problem ? (
          <Notice
            tone="danger"
            title={`${payout ? 'Payout' : 'Adjustment'} could not be recorded`}
          >
            <p>{problem}</p>
            {uncertain ? (
              <Button
                className="mt-3"
                variant="secondary"
                onClick={() => window.location.reload()}
              >
                Reload seller money
              </Button>
            ) : null}
          </Notice>
        ) : null}
        {success ? <Notice tone="success">{success}</Notice> : null}
        {!payout ? (
          <Field label="Balance change" htmlFor="adjustment-direction">
            <Select
              value={direction}
              onChange={(event) => setDirection(event.target.value)}
              disabled={disabled}
            >
              <option value="increase">Increase balance (+)</option>
              <option value="reduce">Reduce balance (-)</option>
            </Select>
          </Field>
        ) : null}
        <Field
          label={payout ? 'Payout amount (₹)' : 'Adjustment amount (₹)'}
          htmlFor={`${kind}-amount`}
          required
          error={amountError}
          hint="Enter rupees with up to two decimal places, without commas."
        >
          <Input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            disabled={disabled || unavailable}
            maxLength={20}
          />
        </Field>
        {payout ? (
          <Field
            label="Bank transfer reference (UTR)"
            htmlFor="payout-reference"
            required
            hint="6 to 40 letters, digits, hyphens or slashes. Use the reference from the completed transfer."
          >
            <Input
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              maxLength={40}
              disabled={disabled || unavailable}
            />
          </Field>
        ) : (
          <Field label="Adjustment reason" htmlFor="adjustment-reason" required>
            <Textarea
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              maxLength={500}
              disabled={disabled}
            />
          </Field>
        )}
        <div>
          <ConfirmationDialog
            title={
              payout
                ? 'Record this completed payout?'
                : 'Record this balance adjustment?'
            }
            description={
              payout
                ? `Record ${signedAmount} already paid to account ending ${bank?.accountNumberLast4 ?? 'unavailable'} (${bank?.ifsc ?? 'unavailable'}), reference ${detail.trim().toUpperCase()}. This only records the completed transfer; it does not send money.`
                : `Change the seller’s balance by ${signedAmount}. Reason: ${detail.trim()}. This adds a permanent ledger entry.`
            }
            trigger={
              saving
                ? 'Recording...'
                : payout
                  ? 'Review payout record'
                  : 'Review adjustment'
            }
            confirmLabel={
              payout ? 'Record completed payout' : 'Record adjustment'
            }
            onConfirm={() => void record()}
            triggerDisabled={
              disabled || unavailable || !positive || !detail.trim()
            }
            confirmDisabled={disabled || unavailable}
          />
        </div>
      </form>
    </Card>
  )
}
