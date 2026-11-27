'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Card, Notice } from '@/components/ui/feedback'
import { Field, Input, Textarea } from '@/components/ui/form-controls'
import { ApiError, apiRequest } from '@/lib/api-client'
import { paiseToRupeeInput, parseRupeesToPaise } from '@/lib/admin-settings'
import { formatInr } from '@/lib/format'

function useOrderAction() {
  const router = useRouter()
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const [problem, setProblem] = useState<{
    message: string
    issues: string[]
  } | null>(null)
  const [success, setSuccess] = useState('')
  async function save(path: string, json: unknown, message: string) {
    if (lock.current || refreshing) return
    lock.current = true
    setBusy(true)
    setProblem(null)
    setSuccess('')
    try {
      await apiRequest(path, {
        method: 'POST',
        ...(json === undefined ? {} : { json }),
      })
      setSuccess(message)
    } catch (cause) {
      setProblem(
        cause instanceof ApiError
          ? { message: cause.message, issues: cause.issues }
          : {
              message:
                'The result could not be confirmed. Refresh and check the order before trying again.',
              issues: [],
            },
      )
    } finally {
      startTransition(() => router.refresh())
      setBusy(false)
      lock.current = false
    }
  }
  return {
    save,
    pending: busy || refreshing,
    feedback: (
      <>
        {problem ? (
          <Notice tone="danger" title={problem.message}>
            {problem.issues.length ? (
              <ul>
                {problem.issues.map((issue) => (
                  <li key={issue}>
                    {issue
                      .replace(/^amountPaise\b/, 'Refund amount')
                      .replace(/^razorpayRefundId\b/, 'Razorpay refund ID')}
                  </li>
                ))}
              </ul>
            ) : null}
          </Notice>
        ) : null}
        {success ? <Notice title={success} /> : null}
      </>
    ),
  }
}

export function AdminOrderActions({
  orderId,
  orderNumber,
  canCancel,
  needsRefund,
  paidOnline,
  capturedPaise,
}: {
  orderId: string
  orderNumber: string
  canCancel: boolean
  needsRefund: boolean
  paidOnline: boolean
  capturedPaise: number | null
}) {
  const action = useOrderAction()
  const [reason, setReason] = useState('')
  const [amount, setAmount] = useState(paiseToRupeeInput(capturedPaise))
  const [reference, setReference] = useState('')
  const parsed = parseRupeesToPaise(amount)
  const amountError = !parsed.ok
    ? parsed.error
    : parsed.value < 1
      ? 'Enter the full amount refunded.'
      : undefined
  const referenceValid = /^rfnd_[A-Za-z0-9]{14}$/.test(reference.trim())
  return (
    <Card className="grid gap-4" aria-label="Administrator order actions">
      <h2 className="text-lg font-semibold">Order actions</h2>
      {action.feedback}
      {canCancel ? (
        <div className="grid gap-3">
          <Field
            label="Cancellation reason"
            htmlFor="cancel-reason"
            required
            hint="This reason is saved in the order history."
          >
            <Textarea
              id="cancel-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              disabled={action.pending}
            />
          </Field>
          <div>
            <ConfirmationDialog
              title={`Cancel order ${orderNumber}?`}
              description={`Every item will be cancelled and returned to stock. This cannot be undone.${paidOnline ? ' The buyer paid online. You must make the refund separately and record it afterwards.' : ''} Reason: ${reason.trim()}`}
              trigger={action.pending ? 'Saving...' : 'Cancel order'}
              confirmLabel="Confirm cancellation"
              dismissLabel="Keep order"
              danger
              triggerDisabled={action.pending || !reason.trim()}
              confirmDisabled={action.pending || !canCancel}
              onConfirm={() =>
                void action.save(
                  `/api/admin/orders/${orderId}/cancel`,
                  { reason: reason.trim() },
                  'Order cancelled.',
                )
              }
            />
          </div>
        </div>
      ) : null}
      {needsRefund ? (
        <div className="grid gap-3">
          <h3 className="font-semibold">Record an already-made refund</h3>
          <Notice title="No money is moved">
            First make the refund in the Razorpay dashboard. This only records
            that refund in EcoKart; it does not send money to the buyer.
          </Notice>
          <Field
            label="Refund amount (₹)"
            htmlFor="refund-amount"
            required
            error={amountError}
            hint={
              capturedPaise === null
                ? 'Enter the full outstanding refund, not a partial refund.'
                : `Captured payment: ${formatInr(capturedPaise)}. Record the full outstanding refund.`
            }
          >
            <Input
              id="refund-amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              disabled={action.pending}
            />
          </Field>
          <Field
            label="Razorpay refund ID"
            htmlFor="refund-reference"
            required
            hint="Copy the refund ID from Razorpay, for example rfnd_FP8QHiV938haTz."
            error={
              reference && !referenceValid
                ? 'Enter rfnd_ followed by 14 letters or digits.'
                : undefined
            }
          >
            <Input
              id="refund-reference"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              disabled={action.pending}
              autoComplete="off"
            />
          </Field>
          <div>
            <ConfirmationDialog
              title="Record this completed refund?"
              description={`Confirm that ${parsed.ok ? formatInr(parsed.value) : 'the full amount'} has already been refunded through Razorpay, with reference ${reference.trim()}. No money is moved by this action.`}
              trigger={action.pending ? 'Saving...' : 'Record refund'}
              confirmLabel="Confirm refund record"
              triggerDisabled={
                action.pending || Boolean(amountError) || !referenceValid
              }
              confirmDisabled={action.pending || !needsRefund}
              onConfirm={() => {
                if (parsed.ok && parsed.value > 0 && referenceValid)
                  void action.save(
                    `/api/admin/orders/${orderId}/refund`,
                    {
                      method: 'gateway',
                      amountPaise: parsed.value,
                      razorpayRefundId: reference.trim(),
                    },
                    'Refund recorded. No money was moved by EcoKart.',
                  )
              }}
            />
          </div>
        </div>
      ) : null}
      {!canCancel && !needsRefund ? (
        <p className="text-sm text-muted">
          No cancellation or refund action is available for this order.
        </p>
      ) : null}
    </Card>
  )
}

export function AdminDeliveryAction({
  shipmentId,
  trackingNumber,
  cod,
  delivered,
}: {
  shipmentId: string
  trackingNumber: string
  cod: boolean
  delivered: boolean
}) {
  const action = useOrderAction()
  return (
    <div className="grid gap-3">
      {action.feedback}
      {!delivered ? (
        <div>
          <ConfirmationDialog
            title={`Mark parcel ${trackingNumber} delivered?`}
            description={`Confirm that the buyer received this parcel.${cod ? ' For cash on delivery, confirm payment was collected. Delivering the last parcel marks the order paid.' : ''}`}
            trigger={action.pending ? 'Saving...' : 'Mark delivered'}
            confirmLabel="Confirm delivery"
            triggerDisabled={action.pending}
            confirmDisabled={action.pending || delivered}
            onConfirm={() =>
              void action.save(
                `/api/admin/shipments/${shipmentId}/delivered`,
                undefined,
                'Parcel marked delivered.',
              )
            }
          />
        </div>
      ) : null}
    </div>
  )
}

export function AdminInvoiceAction({
  invoiceId,
  invoiceNumber,
}: {
  invoiceId: string
  invoiceNumber: string
}) {
  const action = useOrderAction()
  return (
    <div className="grid gap-3">
      {action.feedback}
      <div>
        <ConfirmationDialog
          title={`Make invoice ${invoiceNumber} again?`}
          description="A background job will remake the PDF from its saved invoice details. The invoice number and amounts stay the same."
          trigger={action.pending ? 'Requesting PDF...' : 'Make PDF again'}
          confirmLabel="Queue invoice PDF"
          triggerDisabled={action.pending}
          confirmDisabled={action.pending}
          onConfirm={() =>
            void action.save(
              `/api/admin/invoices/${invoiceId}/render`,
              undefined,
              'PDF generation queued. Refresh the order to check availability. An existing download may still be the previous PDF. If no PDF becomes available, check background work before retrying.',
            )
          }
        />
      </div>
    </div>
  )
}
