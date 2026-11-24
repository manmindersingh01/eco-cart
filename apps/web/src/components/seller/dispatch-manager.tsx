'use client'

import type { SellerOrderView } from '@ecokart/core'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Card, Notice } from '@/components/ui/feedback'
import { Checkbox, Field, Input } from '@/components/ui/form-controls'
import { ApiError, apiRequest } from '@/lib/api-client'

type Line = Pick<
  SellerOrderView['lines'][number],
  'id' | 'title' | 'sku' | 'quantity' | 'status'
> & {
  shipment: {
    id: string
    courierName: string
    trackingNumber: string
    status: string
  } | null
}

export function DispatchManager({
  orderId,
  lines,
  cod,
}: {
  orderId: string
  lines: Line[]
  cod: boolean
}) {
  const router = useRouter()
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const [selected, setSelected] = useState<string[]>([])
  const [problem, setProblem] = useState<{
    message: string
    issues: string[]
  } | null>(null)
  const [success, setSuccess] = useState('')
  const pending = busy || refreshing
  const available = lines.filter((line) => line.status === 'confirmed')
  const parcels = [
    ...new Map(
      lines.flatMap((line) =>
        line.shipment ? [[line.shipment.id, line.shipment] as const] : [],
      ),
    ).values(),
  ]

  async function save(
    path: string,
    json: unknown,
    message: string,
    form?: HTMLFormElement,
  ) {
    if (lock.current || refreshing) return
    lock.current = true
    setBusy(true)
    setProblem(null)
    setSuccess('')
    try {
      await apiRequest(path, { method: 'POST', json })
      setSelected([])
      form?.reset()
      setSuccess(message)
    } catch (cause) {
      setProblem(
        cause instanceof ApiError
          ? { message: cause.message, issues: cause.issues }
          : {
              message:
                'The result could not be confirmed. Refresh the order before trying again.',
              issues: [],
            },
      )
    } finally {
      startTransition(() => router.refresh())
      setBusy(false)
      lock.current = false
    }
  }

  return (
    <Card className="grid gap-4">
      <h2 className="text-lg font-semibold">Dispatch and delivery</h2>
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
      {available.length ? (
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            const form = event.currentTarget
            const values = new FormData(form)
            const trackingUrl = values.get('trackingUrl')
            const lineIds = selected.filter((id) =>
              available.some((line) => line.id === id),
            )
            if (!lineIds.length) {
              setProblem({
                message: 'Select at least one item for this parcel.',
                issues: [],
              })
              return
            }
            void save(
              `/api/seller/orders/${orderId}/shipments`,
              {
                lineIds,
                courierName: values.get('courierName'),
                trackingNumber: values.get('trackingNumber'),
                trackingUrl:
                  typeof trackingUrl === 'string'
                    ? trackingUrl.trim() || null
                    : null,
              },
              'Parcel recorded. The buyer can now see its tracking details.',
              form,
            )
          }}
        >
          <fieldset disabled={pending} className="grid min-w-0 gap-3">
            <legend className="mb-2 font-medium">Items in this parcel</legend>
            <p className="text-sm text-muted">
              Select the whole order lines travelling together. Record another
              parcel for the remaining lines.
            </p>
            {available.map((line) => (
              <label
                key={line.id}
                className="flex min-h-11 items-center gap-3 text-sm"
              >
                <Checkbox
                  checked={selected.includes(line.id)}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? [...selected, line.id]
                        : selected.filter((id) => id !== line.id),
                    )
                  }
                />
                <span className="min-w-0 break-words">
                  {line.quantity} × {line.title} (SKU: {line.sku})
                </span>
              </label>
            ))}
            <Field label="Courier name" htmlFor="dispatch-courier" required>
              <Input name="courierName" required maxLength={100} />
            </Field>
            <Field label="Tracking number" htmlFor="dispatch-tracking" required>
              <Input name="trackingNumber" required maxLength={100} />
            </Field>
            <Field
              label="Tracking link (optional)"
              htmlFor="dispatch-url"
              hint="Use a link beginning with https://."
            >
              <Input
                name="trackingUrl"
                type="url"
                pattern="https://.*"
                maxLength={500}
              />
            </Field>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Record dispatch'}
            </Button>
          </fieldset>
        </form>
      ) : (
        <p className="text-sm text-muted">No items are waiting for dispatch.</p>
      )}
      {parcels.map((parcel) => (
        <div key={parcel.id} className="grid gap-2 border-t pt-4">
          <p className="font-medium break-words">
            {parcel.courierName}: {parcel.trackingNumber}
          </p>
          {parcel.status === 'delivered' ? (
            <p className="text-sm">Delivered</p>
          ) : (
            <ConfirmationDialog
              title={`Mark ${parcel.trackingNumber} delivered?`}
              description={
                cod
                  ? 'Confirm that the buyer received this parcel. Cash on delivery is recorded as collected when the final parcel in the order is delivered.'
                  : 'Confirm that the buyer received this parcel. This cannot be undone here.'
              }
              trigger="Mark delivered"
              confirmLabel="Confirm delivery"
              triggerDisabled={pending}
              onConfirm={() =>
                void save(
                  `/api/seller/shipments/${parcel.id}/delivered`,
                  {},
                  'Delivery recorded. Order details have been refreshed.',
                )
              }
            />
          )}
        </div>
      ))}
    </Card>
  )
}
