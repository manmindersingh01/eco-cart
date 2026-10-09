'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { SellerBusinessFields } from './seller-form-fields'
import { Button } from '@/components/ui/button'
import { Card, Notice } from '@/components/ui/feedback'
import { Field, Input } from '@/components/ui/form-controls'
import { issuesFor } from '@/lib/admin-settings'
import {
  sellerDetailHref,
  serialiseNewSeller,
  type SellerDetail,
  type SellerFormValues,
} from '@/lib/admin-sellers'
import { ApiError, apiRequest } from '@/lib/api-client'

const emptySeller: SellerFormValues = {
  owner: { email: '', name: '', phoneNumber: '' },
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

export function NewSellerForm() {
  const router = useRouter()
  const [values, setValues] = useState(emptySeller)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issues, setIssues] = useState<string[]>([])

  const fieldError = (path: string) =>
    issuesFor(issues, path).join('. ') || undefined

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = serialiseNewSeller(values)
    if (!input.ok) {
      setError(input.error)
      setIssues([])
      return
    }

    setPending(true)
    setError(null)
    setIssues([])
    try {
      const response = await apiRequest<{ seller: SellerDetail }>(
        '/api/admin/sellers',
        { method: 'POST', json: input.value },
      )
      router.push(sellerDetailHref(response.seller.id))
      router.refresh()
    } catch (cause) {
      if (cause instanceof ApiError) {
        if (cause.status === 401) {
          window.location.assign(
            '/sign-in?returnTo=%2Fadmin%2Fsellers%2Fnew&reason=session-ended',
          )
          return
        }
        setError(
          cause.status === 409
            ? `${cause.message} Your entries are still here. Review them and try again.`
            : cause.message,
        )
        setIssues(cause.issues)
      } else {
        setError(
          'The seller could not be created. Check your connection and try again.',
        )
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <Card className="p-0">
      <form onSubmit={submit} noValidate>
        <div className="grid gap-7 p-5 sm:p-6">
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-3 font-semibold sm:col-span-2">
              Owner account
            </legend>
            <Field
              label="Owner name"
              htmlFor="seller-owner-name"
              error={fieldError('owner.name')}
              required
            >
              <Input
                value={values.owner.name}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    owner: { ...current.owner, name: event.target.value },
                  }))
                }
                autoComplete="name"
                disabled={pending}
              />
            </Field>
            <Field
              label="Owner email"
              htmlFor="seller-owner-email"
              hint="This becomes the seller's sign-in address and must not belong to another account."
              error={fieldError('owner.email')}
              required
            >
              <Input
                type="email"
                value={values.owner.email}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    owner: { ...current.owner, email: event.target.value },
                  }))
                }
                autoComplete="email"
                disabled={pending}
              />
            </Field>
            <Field
              label="Owner mobile"
              htmlFor="seller-owner-phone"
              hint="Optional. Use an Indian mobile in international format, for example +919812345678."
              error={fieldError('owner.phoneNumber')}
            >
              <Input
                type="tel"
                value={values.owner.phoneNumber}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    owner: {
                      ...current.owner,
                      phoneNumber: event.target.value,
                    },
                  }))
                }
                autoComplete="tel"
                disabled={pending}
              />
            </Field>
          </fieldset>

          <SellerBusinessFields
            values={values}
            issues={issues}
            disabled={pending}
            onChange={(key, value) =>
              setValues((current) => ({ ...current, [key]: value }))
            }
          />
        </div>

        {error ? (
          <Notice title={error} tone="danger" className="mx-5 mb-5 sm:mx-6">
            {issues.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5">
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            ) : null}
          </Notice>
        ) : null}

        <div className="flex justify-end border-t bg-surface-subtle p-5 sm:p-6">
          <Button type="submit" disabled={pending}>
            {pending ? 'Creating seller...' : 'Create pending seller'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
