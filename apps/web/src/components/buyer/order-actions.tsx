'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Notice } from '@/components/ui/feedback'
import { ApiError, apiRequest } from '@/lib/api-client'
import { payOnline, type OnlinePayment } from '@/lib/razorpay-checkout'

/**
 * What the buyer can do with their order now: pay for an online order that
 * is still waiting, and cancel while nothing has been dispatched. The server
 * decides both; the page shows only what its answer allows.
 */
export function OrderActions({
  orderId,
  orderNumber,
  canPay,
  canCancel,
  paid,
}: {
  orderId: string
  orderNumber: string
  canPay: boolean
  canCancel: boolean
  /** A paid order is refunded when cancelled, so the dialog says so. */
  paid: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<'pay' | 'cancel' | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const failed = (cause: unknown) =>
    setProblem(
      cause instanceof ApiError
        ? cause.message
        : 'That did not work. Check your connection and try again.',
    )

  async function pay() {
    setBusy('pay')
    setProblem(null)
    try {
      const { payment } = await apiRequest<{ payment: OnlinePayment }>(
        `/api/account/orders/${orderId}/payment`,
      )
      const outcome = await payOnline(payment, orderNumber)
      if (outcome.kind === 'unchecked' || outcome.kind === 'unavailable') {
        setProblem(outcome.message)
      }
      if (outcome.kind !== 'closed') router.refresh()
    } catch (cause) {
      failed(cause)
      // A 409 means the order changed meanwhile, for example it expired.
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  async function cancel() {
    setBusy('cancel')
    setProblem(null)
    try {
      await apiRequest(`/api/account/orders/${orderId}/cancel`, {
        method: 'POST',
        json: {},
      })
    } catch (cause) {
      failed(cause)
    } finally {
      setBusy(null)
      router.refresh()
    }
  }

  if (!canPay && !canCancel) return null
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-3">
        {canPay ? (
          <Button onClick={() => void pay()} disabled={busy !== null}>
            {busy === 'pay' ? 'Opening payment...' : 'Pay now'}
          </Button>
        ) : null}
        {canCancel ? (
          <ConfirmationDialog
            title={`Cancel order ${orderNumber}?`}
            description={
              paid
                ? 'Every item in this order is cancelled and goes back on sale. You paid online, so the full amount is refunded to the way you paid.'
                : 'Every item in this order is cancelled and goes back on sale. This cannot be undone.'
            }
            trigger={busy === 'cancel' ? 'Cancelling...' : 'Cancel order'}
            confirmLabel="Yes, cancel order"
            dismissLabel="Keep order"
            danger
            triggerDisabled={busy !== null}
            onConfirm={() => void cancel()}
          />
        ) : null}
      </div>
      {problem ? <Notice tone="danger" title={problem} /> : null}
    </div>
  )
}
