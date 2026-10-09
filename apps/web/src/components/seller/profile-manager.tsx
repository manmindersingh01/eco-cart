'use client'

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card, Notice, StatusBadge } from '@/components/ui/feedback'
import { Field, Input } from '@/components/ui/form-controls'
import { PageHeader } from '@/components/ui/page-header'
import { issuesFor } from '@/lib/admin-settings'
import { ApiError, apiRequest } from '@/lib/api-client'
import { formatIndianDate } from '@/lib/format'
import {
  changedSellerContacts,
  contactValuesFromSeller,
  sellerCommissionLabel,
  sellerStatusPresentation,
  type SellerContactValues,
  type SellerProfile,
} from '@/lib/seller-profile'

type Feedback = {
  error: string | null
  issues: string[]
  success: string | null
}

const idleFeedback: Feedback = { error: null, issues: [], success: null }

export function SellerProfileManager({
  initialSeller,
}: {
  initialSeller: SellerProfile
}) {
  const [seller, setSeller] = useState(initialSeller)
  const [initialValues, setInitialValues] = useState(() =>
    contactValuesFromSeller(initialSeller),
  )
  const [values, setValues] = useState(initialValues)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState(idleFeedback)
  const changes = changedSellerContacts(initialValues, values)
  const status = sellerStatusPresentation(seller.status)

  function update(key: keyof SellerContactValues, value: string) {
    setValues((current) => ({ ...current, [key]: value }))
    setFeedback(idleFeedback)
  }

  function fieldError(path: keyof SellerContactValues): string | undefined {
    return issuesFor(feedback.issues, path).join('. ') || undefined
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!changes) {
      setFeedback({
        ...idleFeedback,
        error: 'Change at least one contact field before saving.',
      })
      return
    }

    setPending(true)
    setFeedback(idleFeedback)
    try {
      const response = await apiRequest<{ seller: SellerProfile }>(
        '/api/seller/profile',
        { method: 'PATCH', json: changes },
      )
      const savedValues = contactValuesFromSeller(response.seller)
      setSeller(response.seller)
      setInitialValues(savedValues)
      setValues(savedValues)
      setFeedback({
        ...idleFeedback,
        success: 'Your contact details were saved.',
      })
    } catch (cause) {
      if (cause instanceof ApiError) {
        if (cause.status === 401) {
          window.location.assign(
            '/sign-in?returnTo=%2Fseller%2Fprofile&reason=session-ended',
          )
          return
        }
        if (cause.status === 403) {
          window.location.assign('/access-denied?area=seller&reason=wrong-role')
          return
        }
        setFeedback({
          error: cause.message,
          issues: cause.issues,
          success: null,
        })
      } else {
        setFeedback({
          ...idleFeedback,
          error:
            'Your contact details could not be saved. Check your connection and try again.',
        })
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid gap-7">
      <PageHeader
        title="Business profile"
        description="Review the business details EcoKart uses for your seller account and invoices."
      />

      <Notice title={status.title} tone={status.tone}>
        <p>{status.description}</p>
        {seller.suspendedReason ? (
          <p className="mt-2 font-medium">Reason: {seller.suspendedReason}</p>
        ) : null}
      </Notice>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Business identity</h2>
              <p className="mt-1 text-sm text-muted">
                Legal and tax details are maintained by an administrator.
              </p>
            </div>
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          </div>
          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            <Detail label="Display name" value={seller.displayName} />
            <Detail label="Legal name" value={seller.legalName} />
            <Detail label="Seller URL name" value={seller.slug} />
            <Detail label="GSTIN" value={seller.gstin ?? 'Not provided'} />
            <Detail label="PAN" value={seller.pan ?? 'Not provided'} />
            <Detail label="Invoice prefix" value={seller.invoicePrefix} />
            <Detail
              label="Commission"
              value={sellerCommissionLabel(seller.commissionBps)}
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
          <h2 className="text-lg font-semibold">Registered address</h2>
          <p className="mt-1 text-sm text-muted">
            Ask an administrator to correct this address because it appears on
            legal records and invoices.
          </p>
          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            <Detail label="Address" value={seller.line1} />
            <Detail label="City" value={seller.city} />
            <Detail label="GST state code" value={seller.stateCode} />
            <Detail label="PIN code" value={seller.pincode} />
          </dl>
        </Card>
      </div>

      <Card className="p-0">
        <form onSubmit={save} noValidate>
          <div className="border-b p-5 sm:p-6">
            <h2 className="text-lg font-semibold">Contact details</h2>
            <p className="mt-1 text-sm text-muted">
              You can update these customer-facing details. An administrator
              maintains your legal name, tax details, address, invoice prefix,
              and commission.
            </p>
          </div>
          <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
            <Field
              label="Display name"
              htmlFor="seller-display-name"
              error={fieldError('displayName')}
              required
              className="sm:col-span-2"
            >
              <Input
                value={values.displayName}
                onChange={(event) => update('displayName', event.target.value)}
                autoComplete="organization"
                maxLength={100}
                disabled={pending}
              />
            </Field>
            <Field
              label="Support email"
              htmlFor="seller-support-email"
              error={fieldError('supportEmail')}
              required
            >
              <Input
                type="email"
                value={values.supportEmail}
                onChange={(event) => update('supportEmail', event.target.value)}
                autoComplete="email"
                disabled={pending}
              />
            </Field>
            <Field
              label="Support phone"
              htmlFor="seller-support-phone"
              hint="Use international format, for example +919812345678."
              error={fieldError('supportPhone')}
              required
            >
              <Input
                type="tel"
                value={values.supportPhone}
                onChange={(event) => update('supportPhone', event.target.value)}
                autoComplete="tel"
                disabled={pending}
              />
            </Field>
          </div>

          {feedback.error ? (
            <Notice
              title={feedback.error}
              tone="danger"
              className="mx-5 mb-5 sm:mx-6 sm:mb-6"
            >
              {feedback.issues.length > 0 ? (
                <ul className="list-disc space-y-1 pl-5">
                  {feedback.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              ) : null}
            </Notice>
          ) : null}
          {feedback.success ? (
            <Notice tone="success" className="mx-5 mb-5 sm:mx-6 sm:mb-6">
              {feedback.success}
            </Notice>
          ) : null}

          <div className="flex flex-col gap-3 border-t bg-surface-subtle p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <p className="text-sm text-muted">
              Last updated{' '}
              {formatIndianDate(seller.updatedAt, { includeTime: true })}
            </p>
            <Button type="submit" disabled={pending || !changes}>
              {pending ? 'Saving...' : 'Save contact details'}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">Record dates</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <Detail
            label="Seller created"
            value={formatIndianDate(seller.createdAt, { includeTime: true })}
          />
          <Detail
            label="Last updated"
            value={formatIndianDate(seller.updatedAt, { includeTime: true })}
          />
        </dl>
      </Card>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 break-words font-medium">{value}</dd>
    </div>
  )
}
