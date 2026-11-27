'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Notice } from '@/components/ui/feedback'
import { ApiError, apiRequest } from '@/lib/api-client'
import { useClientReady } from '@/lib/use-client-ready'

export function CouponToggle({
  id,
  code,
  active,
}: {
  id: string
  code: string
  active: boolean
}) {
  const router = useRouter()
  const ready = useClientReady()
  const lock = useRef(false)
  const [saving, setSaving] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const [error, setError] = useState('')
  const disabled = !ready || saving || refreshing
  return (
    <div className="grid gap-3">
      {error ? (
        <Notice tone="danger" title="Coupon status could not be changed">
          {error}
        </Notice>
      ) : null}
      <div>
        <ConfirmationDialog
          title={active ? 'Deactivate coupon?' : 'Enable coupon?'}
          description={`${active ? 'Deactivate' : 'Enable'} ${code}. ${active ? 'Buyers will no longer be able to use it. Existing orders keep their saved discount.' : 'Dates, minimum order and usage limits will still apply.'}`}
          trigger={active ? 'Deactivate coupon' : 'Enable coupon'}
          confirmLabel={active ? 'Deactivate coupon' : 'Enable coupon'}
          danger={active}
          triggerVariant={active ? 'danger' : 'secondary'}
          triggerDisabled={disabled}
          confirmDisabled={disabled}
          onConfirm={() => {
            if (lock.current) return
            lock.current = true
            setSaving(true)
            setError('')
            void apiRequest(`/api/admin/coupons/${id}`, {
              method: 'PATCH',
              json: { isActive: !active },
            })
              .catch((cause: unknown) =>
                setError(
                  cause instanceof ApiError
                    ? cause.message
                    : 'The result could not be confirmed. Refresh the coupon before trying again.',
                ),
              )
              .finally(() => {
                lock.current = false
                setSaving(false)
                startTransition(() => router.refresh())
              })
          }}
        />
      </div>
    </div>
  )
}
