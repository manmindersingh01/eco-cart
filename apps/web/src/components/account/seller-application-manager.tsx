'use client'

import { useState, type FormEvent, type ReactNode } from 'react'
import { ApplicationDocuments } from './application-documents'
import { SellerBusinessFields } from '@/components/admin/seller-form-fields'
import { Button, LinkButton } from '@/components/ui/button'
import { Card, Notice, StatusBadge } from '@/components/ui/feedback'
import { ApiError, apiRequest } from '@/lib/api-client'
import { formatIndianDate, formatState } from '@/lib/format'
import {
  applicationPresentation,
  applicationValues,
  emptyApplication,
  serialiseApplication,
  type ApplicationFormValues,
  type SellerApplication,
} from '@/lib/seller-application'

const RETURN_TO = '/account/seller-application'

type Feedback = {
  error: string | null
  issues: string[]
  success: string | null
}

const idle: Feedback = { error: null, issues: [], success: null }

export function SellerApplicationManager({
  initialApplication,
  canApply,
}: {
  initialApplication: SellerApplication | null
  /** False for an account that does not shop, which cannot apply. */
  canApply: boolean
}) {
  const [application, setApplication] = useState(initialApplication)
  const [values, setValues] = useState<ApplicationFormValues>(() =>
    initialApplication
      ? applicationValues(initialApplication)
      : emptyApplication,
  )
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState(idle)

  const status = application?.status
  const reapplying = status === 'rejected'
  const showForm =
    canApply &&
    (!application || reapplying || (status === 'pending' && editing))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setFeedback(idle)
    // A new or rejected application is sent with POST; a pending one is
    // changed with PATCH.
    const changing = status === 'pending'
    try {
      const answer = await apiRequest<{ application: SellerApplication }>(
        '/api/account/seller-application',
        {
          method: changing ? 'PATCH' : 'POST',
          json: serialiseApplication(values),
        },
      )
      setApplication(answer.application)
      setValues(applicationValues(answer.application))
      setEditing(false)
      setFeedback({
        ...idle,
        success: changing
          ? 'Your changes were saved.'
          : 'Your application was sent. We will email you when it has been reviewed.',
      })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        window.location.assign(
          `/sign-in?returnTo=${encodeURIComponent(RETURN_TO)}&reason=session-ended`,
        )
        return
      }
      setFeedback({
        ...idle,
        error:
          cause instanceof ApiError
            ? cause.message
            : 'Your application could not be sent. Check your connection and try again.',
        issues: cause instanceof ApiError ? cause.issues : [],
      })
    } finally {
      setPending(false)
    }
  }

  const presentation = status ? applicationPresentation(status) : null
  const reason =
    status === 'rejected'
      ? application?.rejectionReason
      : status === 'suspended'
        ? application?.suspendedReason
        : null

  return (
    <div className="grid gap-7">
      {feedback.success ? (
        <Notice tone="success">{feedback.success}</Notice>
      ) : null}

      {!canApply && !application ? (
        <Notice tone="warning" title="This account cannot apply to sell">
          Applications come from buyer accounts. Sign in with the account you
          shop with to apply.
        </Notice>
      ) : null}

      {application && presentation ? (
        <Notice tone={presentation.tone} title={presentation.title}>
          <p>{presentation.description}</p>
          {reason ? (
            <p className="mt-2">
              <span className="font-semibold">Reason:</span> {reason}
            </p>
          ) : null}
          {status === 'approved' ? (
            <LinkButton href="/seller" className="mt-3">
              Open seller portal
            </LinkButton>
          ) : null}
        </Notice>
      ) : null}

      {!application && canApply ? <HowItWorks /> : null}

      {application && !showForm ? (
        <ApplicationSummary
          application={application}
          label={presentation?.label ?? ''}
          tone={presentation?.tone ?? 'warning'}
          action={
            canApply && status === 'pending' ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setFeedback(idle)
                  setEditing(true)
                }}
              >
                Change details
              </Button>
            ) : null
          }
        />
      ) : null}

      {showForm ? (
        <Card className="p-0">
          <form onSubmit={submit} noValidate>
            <div className="border-b p-5 sm:p-6">
              <h2 className="text-lg font-semibold">
                {reapplying
                  ? 'Correct your details and apply again'
                  : status === 'pending'
                    ? 'Change your application'
                    : 'Your business details'}
              </h2>
              <p className="mt-1 text-sm text-muted">
                Fields marked * are required. We use these details on your GST
                invoices and to contact you about your shop.
              </p>
            </div>
            {feedback.error ? (
              <div className="px-5 pt-5 sm:px-6 sm:pt-6">
                <Notice tone="danger" title={feedback.error}>
                  {feedback.issues.length > 0 ? (
                    <ul className="list-disc space-y-1 pl-5">
                      {feedback.issues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  ) : null}
                </Notice>
              </div>
            ) : null}
            <div className="p-5 sm:p-6">
              <SellerBusinessFields
                mode="application"
                values={values}
                issues={feedback.issues}
                disabled={pending}
                onChange={(key, value) => {
                  if (key === 'commissionPercent') return
                  setValues((current) => ({ ...current, [key]: value }))
                }}
              />
            </div>
            <div className="flex flex-wrap justify-end gap-3 border-t bg-surface-subtle p-5 sm:p-6">
              {status === 'pending' ? (
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={() => {
                    setEditing(false)
                    setFeedback(idle)
                    if (application) setValues(applicationValues(application))
                  }}
                >
                  Cancel
                </Button>
              ) : null}
              <Button type="submit" disabled={pending}>
                {pending
                  ? 'Sending...'
                  : status === 'pending'
                    ? 'Save changes'
                    : reapplying
                      ? 'Apply again'
                      : 'Send application'}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {application && (status === 'pending' || status === 'rejected') ? (
        <ApplicationDocuments />
      ) : null}
    </div>
  )
}

function HowItWorks() {
  const steps = [
    {
      title: 'Tell us about your business',
      text: 'Your shop name, legal name, GST details, address, and how buyers can reach you.',
    },
    {
      title: 'We review your application',
      text: 'We may ask for a document, such as your GST certificate. You keep shopping as usual.',
    },
    {
      title: 'Start selling',
      text: 'Once approved, open the seller portal from the same account and add your products.',
    },
  ]
  return (
    <ol className="grid gap-4 md:grid-cols-3">
      {steps.map((step, index) => (
        <li key={step.title}>
          <Card className="h-full">
            <span
              aria-hidden="true"
              className="inline-flex size-8 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand-strong"
            >
              {index + 1}
            </span>
            <h2 className="mt-3 font-semibold">{step.title}</h2>
            <p className="mt-1 text-sm text-muted">{step.text}</p>
          </Card>
        </li>
      ))}
    </ol>
  )
}

function ApplicationSummary({
  application,
  label,
  tone,
  action,
}: {
  application: SellerApplication
  label: string
  tone: 'success' | 'warning' | 'danger'
  action: ReactNode
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{application.displayName}</h2>
          <p className="mt-1 text-sm text-muted">{application.legalName}</p>
        </div>
        <StatusBadge tone={tone}>{label}</StatusBadge>
      </div>
      <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
        <Detail
          label="Applied on"
          value={formatIndianDate(application.createdAt)}
        />
        <Detail
          label="Last changed"
          value={formatIndianDate(application.updatedAt, { includeTime: true })}
        />
        <Detail label="GSTIN" value={application.gstin ?? 'Not added yet'} />
        <Detail label="PAN" value={application.pan ?? 'Not added yet'} />
        <Detail
          label="Registered address"
          value={`${application.line1}, ${application.city}, ${formatState(application.stateCode)} ${application.pincode}`}
        />
        <Detail
          label="Support contact"
          value={`${application.supportEmail}, ${application.supportPhone}`}
        />
        <Detail label="Invoice prefix" value={application.invoicePrefix} />
      </dl>
      {action ? <div className="mt-5 border-t pt-5">{action}</div> : null}
    </Card>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted">{label}</dt>
      <dd className="mt-1 break-words font-medium">{value}</dd>
    </div>
  )
}
