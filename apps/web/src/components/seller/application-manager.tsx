'use client'

import { useState, type FormEvent } from 'react'
import { SellerBusinessFields } from '@/components/admin/seller-form-fields'
import { DocumentsManager } from './documents-manager'
import { Button, LinkButton } from '@/components/ui/button'
import { Card, Notice, StatusBadge } from '@/components/ui/feedback'
import { PageHeader } from '@/components/ui/page-header'
import {
  businessValuesFromSeller,
  type BusinessFormValues,
  type SellerDetail,
} from '@/lib/admin-sellers'
import { apiRequest, ApiError } from '@/lib/api-client'
import { formatStatusLabel } from '@/lib/format'
import { useClientReady } from '@/lib/use-client-ready'

export type Application = Omit<SellerDetail, 'owner'>

const empty: BusinessFormValues = {
  displayName: '',
  legalName: '',
  gstin: '',
  pan: '',
  line1: '',
  city: '',
  stateCode: '',
  pincode: '',
  supportEmail: '',
  supportPhone: '',
  invoicePrefix: '',
  commissionPercent: '',
}

export function ApplicationManager({
  initialApplication,
}: {
  initialApplication: Application | null
}) {
  const ready = useClientReady()
  const [application, setApplication] = useState(initialApplication)
  const [values, setValues] = useState<BusinessFormValues>(() =>
    initialApplication
      ? businessValuesFromSeller({ ...initialApplication, owner: null })
      : empty,
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const [saved, setSaved] = useState(false)
  const editable =
    !application ||
    application.status === 'pending' ||
    application.status === 'rejected'

  async function save(event: FormEvent, resubmit = false) {
    event.preventDefault()
    setPending(true)
    setError(null)
    setIssues([])
    setSaved(false)
    // Only application fields are sent, never owner, role or commercial values.
    const {
      commissionPercent: _commission,
      invoicePrefix,
      gstin,
      pan,
      ...business
    } = values
    void _commission
    try {
      const result = await apiRequest<{ application: Application }>(
        '/api/account/seller-application',
        {
          method: application && !resubmit ? 'PATCH' : 'POST',
          json: {
            ...business,
            gstin: gstin.trim() || null,
            pan: pan.trim() || null,
            ...(invoicePrefix.trim()
              ? { invoicePrefix: invoicePrefix.trim() }
              : {}),
          },
        },
      )
      setApplication(result.application)
      setSaved(true)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Your application could not be saved.',
      )
      if (cause instanceof ApiError) {
        setIssues(cause.issues)
        if (cause.status === 409) {
          // Keep unsaved fields while refreshing the authoritative decision.
          const current = await apiRequest<{ application: Application }>(
            '/api/account/seller-application',
          ).catch(() => null)
          if (current) setApplication(current.application)
        }
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid gap-7">
      <PageHeader
        title="Sell on EcoKart"
        description="Apply with this account and keep shopping while your business is reviewed."
        actions={
          <LinkButton href="/" variant="secondary">
            Continue shopping
          </LinkButton>
        }
      />
      {error ? (
        <Notice title={error} tone="danger">
          {issues.length ? (
            <ul className="list-disc pl-5">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </Notice>
      ) : null}
      {saved ? (
        <Notice tone="success">
          Application saved. Your current status is {application?.status}.
        </Notice>
      ) : null}
      {application ? (
        <Card>
          <h2 className="text-lg font-semibold">Application status</h2>
          <StatusBadge className="mt-3">
            {formatStatusLabel(application.status)}
          </StatusBadge>
          {application.rejectionReason || application.suspendedReason ? (
            <p className="mt-3">
              Reason:{' '}
              {application.rejectionReason ?? application.suspendedReason}
            </p>
          ) : null}
          {application.status === 'approved' ? (
            <div className="mt-4">
              <LinkButton href="/seller">Open seller portal</LinkButton>
              <p className="mt-3 text-sm">
                Your account can now buy and sell. Refresh this page to update
                account navigation.
              </p>
            </div>
          ) : application.status === 'suspended' ? (
            <p className="mt-3">
              Selling is suspended. You can continue shopping. Contact EcoKart
              about your business.
            </p>
          ) : (
            <p className="mt-3">
              You can update details while awaiting review. Only an
              administrator can approve your business.
            </p>
          )}
          <Button
            className="mt-3"
            variant="secondary"
            onClick={() => window.location.reload()}
          >
            Refresh application status
          </Button>
        </Card>
      ) : null}
      {editable ? (
        <Card>
          <form
            autoComplete="off"
            onSubmit={save}
            noValidate
            className="grid gap-5"
          >
            <h2 className="text-lg font-semibold">Business application</h2>
            <SellerBusinessFields
              application
              values={values}
              issues={issues}
              disabled={pending || !ready}
              onChange={(key, value) =>
                setValues((current) => ({ ...current, [key]: value }))
              }
            />
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={pending || !ready}>
                {pending
                  ? 'Saving...'
                  : application
                    ? 'Save application details'
                    : 'Submit application'}
              </Button>
              {application?.status === 'rejected' ? (
                <Button
                  type="button"
                  disabled={pending || !ready}
                  onClick={(event) => void save(event, true)}
                >
                  Resubmit application
                </Button>
              ) : null}
            </div>
          </form>
        </Card>
      ) : null}
      {application && application.status !== 'suspended' ? (
        <DocumentsManager />
      ) : null}
    </div>
  )
}
