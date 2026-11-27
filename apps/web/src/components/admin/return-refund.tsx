'use client'

import type { ReturnStatus } from '@ecokart/core'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Card, Notice } from '@/components/ui/feedback'
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls'
import { paiseToRupeeInput, parseRupeesToPaise } from '@/lib/admin-settings'
import { ApiError, apiRequest } from '@/lib/api-client'
import { formatInr } from '@/lib/format'

export function ReturnRefund({
  returnId,
  status,
  maxRefundPaise,
  paymentMethod,
}: {
  returnId: string
  status: ReturnStatus
  maxRefundPaise: number
  paymentMethod: 'razorpay' | 'cod'
}) {
  const router = useRouter()
  const lock = useRef(false)
  const [amount, setAmount] = useState(paiseToRupeeInput(maxRefundPaise))
  const [method, setMethod] = useState<'gateway' | 'bank_transfer'>(
    paymentMethod === 'cod' ? 'bank_transfer' : 'gateway',
  )
  const [reference, setReference] = useState('')
  const [bankReference, setBankReference] = useState('')
  const [saving, setSaving] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const [problem, setProblem] = useState<{
    message: string
    issues: string[]
  } | null>(null)
  const [success, setSuccess] = useState(false)
  const pending = saving || refreshing
  const parsed = parseRupeesToPaise(amount)
  const amountError = !parsed.ok
    ? parsed.error
    : parsed.value < 1
      ? 'Enter an amount greater than zero.'
      : parsed.value > maxRefundPaise
        ? `Enter no more than ${formatInr(maxRefundPaise)}.`
        : undefined
  const gateway = paymentMethod === 'razorpay' && method === 'gateway'
  const referenceValid = gateway
    ? /^rfnd_[A-Za-z0-9]{14}$/.test(reference.trim())
    : Boolean(bankReference.trim())
  async function record() {
    if (
      lock.current ||
      pending ||
      status !== 'approved' ||
      !parsed.ok ||
      amountError ||
      !referenceValid
    )
      return
    lock.current = true
    setSaving(true)
    setProblem(null)
    try {
      await apiRequest(`/api/admin/returns/${returnId}/refund`, {
        method: 'POST',
        json: gateway
          ? {
              method: 'gateway',
              amountPaise: parsed.value,
              razorpayRefundId: reference.trim(),
            }
          : {
              method: 'bank_transfer',
              amountPaise: parsed.value,
              note: bankReference.trim(),
            },
      })
      setSuccess(true)
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
    <Card className="grid gap-3" aria-label="Record return refund">
      <h2 className="text-lg font-semibold">Record an already-made refund</h2>
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
      {success ? (
        <Notice tone="success" title="Refund recorded">
          EcoKart recorded the external transfer. No money was moved by this
          action.
        </Notice>
      ) : null}
      {status === 'approved' && !success ? (
        <>
          <Notice title="No money is moved">
            First refund the buyer outside EcoKart. This only records a
            completed Razorpay refund or bank transfer; it does not send money.
          </Notice>
          <p className="text-sm">
            Maximum refundable value: {formatInr(maxRefundPaise)}. Recording a
            smaller amount completes this return too. Check the actual transfer
            before continuing.
          </p>
          <Field
            label="Refund amount (₹)"
            htmlFor="return-refund-amount"
            required
            error={amountError}
          >
            <Input
              id="return-refund-amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              disabled={pending}
            />
          </Field>
          {paymentMethod === 'razorpay' ? (
            <Field label="Refund method" htmlFor="return-refund-method">
              <Select
                id="return-refund-method"
                value={method}
                onChange={(event) =>
                  setMethod(
                    event.target.value === 'gateway'
                      ? 'gateway'
                      : 'bank_transfer',
                  )
                }
                disabled={pending}
              >
                <option value="gateway">Razorpay</option>
                <option value="bank_transfer">Bank transfer</option>
              </Select>
            </Field>
          ) : (
            <p className="text-sm">Cash on delivery: record a bank transfer.</p>
          )}
          {gateway ? (
            <Field
              label="Razorpay refund ID"
              htmlFor="return-refund-reference"
              required
              hint="Copy the ID from Razorpay, for example rfnd_FP8QHiV938haTz."
              error={
                reference && !referenceValid
                  ? 'Enter rfnd_ followed by 14 letters or digits.'
                  : undefined
              }
            >
              <Input
                id="return-refund-reference"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                disabled={pending}
                autoComplete="off"
              />
            </Field>
          ) : (
            <Field
              label="Bank transfer reference"
              htmlFor="return-refund-bank"
              required
              hint="Include the bank's transfer reference so the payment can be checked."
            >
              <Textarea
                id="return-refund-bank"
                value={bankReference}
                onChange={(event) => setBankReference(event.target.value)}
                maxLength={500}
                disabled={pending}
              />
            </Field>
          )}
          <div>
            <ConfirmationDialog
              title="Record this completed refund?"
              description={`Confirm that ${parsed.ok ? formatInr(parsed.value) : 'the amount'} has already been sent to the buyer by ${gateway ? 'Razorpay' : 'bank transfer'}, reference ${gateway ? reference.trim() : bankReference.trim()}. This completes the return and updates stock and the seller ledger. No money is moved by EcoKart.`}
              trigger={pending ? 'Saving...' : 'Record return refund'}
              confirmLabel="Confirm refund record"
              triggerDisabled={
                pending || Boolean(amountError) || !referenceValid
              }
              confirmDisabled={pending || status !== 'approved'}
              onConfirm={() => void record()}
            />
          </div>
        </>
      ) : !success ? (
        <p className="text-sm text-muted">
          Refund recording is available only for approved returns that have not
          been refunded.
        </p>
      ) : null}
    </Card>
  )
}
