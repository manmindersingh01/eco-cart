'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { SellerBusinessFields } from './seller-form-fields'
import { Button, LinkButton } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Card, Notice, StatusBadge } from '@/components/ui/feedback'
import { Field, Input } from '@/components/ui/form-controls'
import { PageHeader } from '@/components/ui/page-header'
import {
  businessValuesFromSeller,
  highImpactBusinessChanges,
  lifecycleActions,
  serialiseBusinessUpdate,
  type SellerDetail,
  type SellerStatus,
} from '@/lib/admin-sellers'
import { ApiError, apiRequest } from '@/lib/api-client'
import {
  formatBasisPoints,
  formatIndianDate,
  formatStatusLabel,
} from '@/lib/format'

type MutationFeedback = {
  error: string | null
  issues: string[]
  success: string | null
  conflict: boolean
}

const idleFeedback: MutationFeedback = {
  error: null,
  issues: [],
  success: null,
  conflict: false,
}

function statusTone(status: SellerStatus) {
  return status === 'approved'
    ? ('success' as const)
    : status === 'suspended'
      ? ('danger' as const)
      : ('warning' as const)
}

export function SellerDetailManager({
  initialSeller,
}: {
  initialSeller: SellerDetail
}) {
  const router = useRouter()
  const [seller, setSeller] = useState(initialSeller)
  const [initialValues, setInitialValues] = useState(() =>
    businessValuesFromSeller(initialSeller),
  )
  const [values, setValues] = useState(initialValues)
  const [editPending, setEditPending] = useState(false)
  const [actionPending, setActionPending] = useState(false)
  const [suspensionReason, setSuspensionReason] = useState('')
  const [feedback, setFeedback] = useState(idleFeedback)
  const actions = lifecycleActions(
    seller.status,
    Boolean(seller.gstin && seller.pan),
  )

  async function loadCurrentSeller(): Promise<SellerDetail> {
    const response = await apiRequest<{ seller: SellerDetail }>(
      `/api/admin/sellers/${seller.id}`,
    )
    setSeller(response.seller)
    const currentValues = businessValuesFromSeller(response.seller)
    setValues(currentValues)
    setInitialValues(currentValues)
    router.refresh()
    return response.seller
  }

  function handleError(cause: unknown) {
    if (cause instanceof ApiError) {
      if (cause.status === 401) {
        window.location.assign(
          `/sign-in?returnTo=${encodeURIComponent(`/admin/sellers/${seller.id}`)}&reason=session-ended`,
        )
        return
      }
      setFeedback({
        error: cause.message,
        issues: cause.issues,
        success: null,
        conflict: cause.status === 409,
      })
      return
    }
    setFeedback({
      ...idleFeedback,
      error:
        'The seller could not be updated. Check your connection and try again.',
    })
  }

  async function saveBusiness(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = serialiseBusinessUpdate(values)
    if (!input.ok) {
      setFeedback({ ...idleFeedback, error: input.error })
      return
    }
    const highImpact = highImpactBusinessChanges(initialValues, values)
    if (
      highImpact.length > 0 &&
      !window.confirm(
        `Confirm changes to ${highImpact.join(', ')}. These details affect seller access or invoices.`,
      )
    ) {
      return
    }

    setEditPending(true)
    setFeedback(idleFeedback)
    try {
      await apiRequest(`/api/admin/sellers/${seller.id}`, {
        method: 'PATCH',
        json: input.value,
      })
      await loadCurrentSeller()
      setFeedback({
        ...idleFeedback,
        success: 'Business details were saved.',
      })
    } catch (cause) {
      handleError(cause)
    } finally {
      setEditPending(false)
    }
  }

  async function runLifecycle(action: 'approve' | 'suspend' | 'reinstate') {
    setActionPending(true)
    setFeedback(idleFeedback)
    try {
      await apiRequest(`/api/admin/sellers/${seller.id}/${action}`, {
        method: 'POST',
        ...(action === 'suspend'
          ? { json: { reason: suspensionReason.trim() } }
          : {}),
      })
      const updated = await loadCurrentSeller()
      setSuspensionReason('')
      setFeedback({
        ...idleFeedback,
        success: `${updated.displayName} is now ${updated.status}.`,
      })
    } catch (cause) {
      handleError(cause)
    } finally {
      setActionPending(false)
    }
  }

  return (
    <div className="grid gap-7">
      <PageHeader
        title={seller.displayName}
        description={seller.legalName}
        actions={
          <LinkButton href="/admin/sellers" variant="secondary">
            Back to sellers
          </LinkButton>
        }
      />

      {feedback.error ? (
        <Notice title={feedback.error} tone="danger">
          {feedback.issues.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5">
              {feedback.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
          {feedback.conflict ? (
            <Button
              variant="secondary"
              className="mt-3"
              onClick={() => window.location.reload()}
            >
              Reload current seller
            </Button>
          ) : null}
        </Notice>
      ) : null}
      {feedback.success ? (
        <Notice tone="success">{feedback.success}</Notice>
      ) : null}

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <p className="text-sm font-medium text-muted">Business status</p>
          <StatusBadge tone={statusTone(seller.status)} className="mt-2">
            {formatStatusLabel(seller.status)}
          </StatusBadge>
          {seller.suspendedReason ? (
            <p className="mt-3 text-sm">
              <span className="font-semibold">Reason:</span>{' '}
              {seller.suspendedReason}
            </p>
          ) : null}
          <dl className="mt-4 grid gap-3 text-sm">
            <Detail
              label="Created"
              value={formatIndianDate(seller.createdAt, { includeTime: true })}
            />
            <Detail
              label="Last updated"
              value={formatIndianDate(seller.updatedAt, { includeTime: true })}
            />
            <Detail
              label="Approved"
              value={
                seller.approvedAt
                  ? formatIndianDate(seller.approvedAt, { includeTime: true })
                  : 'Not approved yet'
              }
            />
          </dl>
        </Card>

        <Card>
          <h2 className="font-semibold">Owner account</h2>
          {seller.owner ? (
            <dl className="mt-4 grid gap-3 text-sm">
              <Detail label="Name" value={seller.owner.name} />
              <Detail label="Email" value={seller.owner.email} />
              <Detail
                label="Mobile"
                value={seller.owner.phoneNumber ?? 'Not provided'}
              />
              <Detail
                label="Account banned"
                value={seller.owner.banned ? 'Yes' : 'No'}
              />
              {seller.owner.banReason ? (
                <Detail label="Ban reason" value={seller.owner.banReason} />
              ) : null}
            </dl>
          ) : (
            <Notice tone="warning" className="mt-4">
              The owner account could not be found. Contact technical support
              before changing this seller.
            </Notice>
          )}
        </Card>

        <Card>
          <h2 className="font-semibold">Business summary</h2>
          <dl className="mt-4 grid gap-3 text-sm">
            <Detail label="GSTIN" value={seller.gstin ?? 'Not provided'} />
            <Detail label="PAN" value={seller.pan ?? 'Not provided'} />
            <Detail label="Invoice prefix" value={seller.invoicePrefix} />
            <Detail
              label="Commission"
              value={
                seller.commissionBps === null
                  ? 'Platform default'
                  : formatBasisPoints(seller.commissionBps)
              }
            />
            <Detail label="Seller URL name" value={seller.slug} />
          </dl>
        </Card>

        <Card>
          <h2 className="font-semibold">Address and support</h2>
          <dl className="mt-4 grid gap-3 text-sm">
            <Detail
              label="Registered address"
              value={`${seller.line1}, ${seller.city}, ${seller.stateCode} ${seller.pincode}`}
            />
            <Detail label="Support email" value={seller.supportEmail} />
            <Detail label="Support phone" value={seller.supportPhone} />
          </dl>
        </Card>
      </div>

      <Card>
        <h2 className="text-lg font-semibold">Lifecycle controls</h2>
        <p className="mt-1 text-sm text-muted">
          Lifecycle changes take effect immediately and are recorded in the
          audit log.
        </p>
        {actions.approveDisabledReason ? (
          <Notice tone="warning" className="mt-4">
            {actions.approveDisabledReason} Approval will show the exact missing
            fields.
          </Notice>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-3">
          {actions.approve ? (
            <ConfirmationDialog
              title="Approve this seller?"
              description="The seller will be allowed to trade on EcoKart. GSTIN and PAN must both be valid."
              trigger="Approve seller"
              confirmLabel="Approve seller"
              onConfirm={() => void runLifecycle('approve')}
              triggerDisabled={actionPending}
              confirmDisabled={actionPending}
            />
          ) : null}
          {actions.reinstate ? (
            <ConfirmationDialog
              title="Reinstate this seller?"
              description="The owner account will be unbanned. The seller returns to its previous approved or pending state."
              trigger="Reinstate seller"
              confirmLabel="Reinstate seller"
              onConfirm={() => void runLifecycle('reinstate')}
              triggerDisabled={actionPending}
              confirmDisabled={actionPending}
            />
          ) : null}
        </div>
        {actions.suspend ? (
          <div className="mt-5 grid max-w-2xl gap-3 border-t pt-5">
            <Field
              label="Suspension reason"
              htmlFor="seller-suspension-reason"
              hint="This reason is stored on the seller and used when banning the owner account."
              required
            >
              <Input
                value={suspensionReason}
                onChange={(event) => setSuspensionReason(event.target.value)}
                maxLength={500}
                disabled={actionPending}
              />
            </Field>
            <div>
              <ConfirmationDialog
                title="Suspend this seller?"
                description={`The seller will lose portal and storefront access. Reason: ${suspensionReason.trim() || 'No reason entered'}`}
                trigger="Suspend seller"
                triggerVariant="danger"
                confirmLabel="Suspend seller"
                onConfirm={() => void runLifecycle('suspend')}
                danger
                triggerDisabled={actionPending || !suspensionReason.trim()}
                confirmDisabled={actionPending || !suspensionReason.trim()}
              />
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="p-0">
        <form onSubmit={saveBusiness} noValidate>
          <div className="border-b p-5 sm:p-6">
            <h2 className="text-lg font-semibold">Edit business details</h2>
            <p className="mt-1 text-sm text-muted">
              Legal, tax, state, and invoice-prefix changes require confirmation
              before saving.
            </p>
          </div>
          <div className="p-5 sm:p-6">
            <SellerBusinessFields
              values={values}
              issues={feedback.issues}
              disabled={editPending || actionPending}
              onChange={(key, value) =>
                setValues((current) => ({ ...current, [key]: value }))
              }
            />
          </div>
          <div className="flex justify-end border-t bg-surface-subtle p-5 sm:p-6">
            <Button type="submit" disabled={editPending || actionPending}>
              {editPending ? 'Saving...' : 'Save business details'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="mt-1 break-words font-medium">{value}</dd>
    </div>
  )
}
