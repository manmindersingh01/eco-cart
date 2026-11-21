'use client'

import type { AddressView } from '@ecokart/core'
import { GST_STATES } from '@ecokart/core/states'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/feedback'
import { Checkbox, Field, Input, Select } from '@/components/ui/form-controls'
import { ApiError, apiRequest } from '@/lib/api-client'

/** An address as the browser receives it, with dates as text. */
export type Address = Omit<AddressView, 'createdAt' | 'updatedAt'>

/**
 * A ten-digit mobile number as the server stores it, +91 first. The buyer
 * types the number as they say it; anything else goes to the server as
 * typed, and its message explains what is wrong.
 */
export function toIndianMobile(typed: string): string {
  const digits = typed.replaceAll(/[\s-]/g, '')
  if (/^\d{10}$/.test(digits)) return `+91${digits}`
  if (/^0\d{10}$/.test(digits)) return `+91${digits.slice(1)}`
  if (/^91\d{10}$/.test(digits)) return `+${digits}`
  return digits
}

const localMobile = (phone: string) => phone.replace(/^\+91/, '')

/**
 * Adds a new address or changes `address`. The server checks every field;
 * its plain messages are shown above the buttons.
 */
export function AddressForm({
  address,
  idPrefix,
  onSaved,
  onCancel,
  showDefault = true,
}: {
  address?: Address
  /** Keeps field ids unique when two forms are on one page. */
  idPrefix: string
  onSaved: (address: Address) => void
  onCancel?: () => void
  showDefault?: boolean
}) {
  const [fields, setFields] = useState({
    fullName: address?.fullName ?? '',
    phone: address ? localMobile(address.phone) : '',
    line1: address?.line1 ?? '',
    line2: address?.line2 ?? '',
    landmark: address?.landmark ?? '',
    city: address?.city ?? '',
    stateCode: address?.stateCode ?? '',
    pincode: address?.pincode ?? '',
  })
  const [makeDefault, setMakeDefault] = useState(false)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<{
    message: string
    issues: string[]
  } | null>(null)

  const set = (name: keyof typeof fields) => (value: string) =>
    setFields((current) => ({ ...current, [name]: value }))
  const id = (name: string) => `${idPrefix}-${name}`

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setProblem(null)
    const body = {
      ...fields,
      phone: toIndianMobile(fields.phone),
      ...(makeDefault ? { isDefault: true } : {}),
    }
    try {
      const answer = await apiRequest<{ address: Address }>(
        address
          ? `/api/account/addresses/${address.id}`
          : '/api/account/addresses',
        { method: address ? 'PATCH' : 'POST', json: body },
      )
      onSaved(answer.address)
    } catch (cause) {
      setProblem(
        cause instanceof ApiError
          ? { message: cause.message, issues: cause.issues }
          : {
              message:
                'The address could not be saved. Check your connection and try again.',
              issues: [],
            },
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={(event) => void save(event)}
      noValidate
      className="grid gap-4 sm:grid-cols-2"
    >
      <Field label="Full name" htmlFor={id('name')} required>
        <Input
          value={fields.fullName}
          onChange={(event) => set('fullName')(event.target.value)}
          autoComplete="name"
          maxLength={100}
        />
      </Field>
      <Field
        label="Mobile number"
        htmlFor={id('phone')}
        hint="The courier calls this number. Ten digits, for example 98123 45678."
        required
      >
        <Input
          value={fields.phone}
          onChange={(event) => set('phone')(event.target.value)}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          maxLength={14}
        />
      </Field>
      <Field
        label="House, building, street"
        htmlFor={id('line1')}
        className="sm:col-span-2"
        required
      >
        <Input
          value={fields.line1}
          onChange={(event) => set('line1')(event.target.value)}
          autoComplete="address-line1"
          maxLength={200}
        />
      </Field>
      <Field
        label="Area or locality (optional)"
        htmlFor={id('line2')}
        className="sm:col-span-2"
      >
        <Input
          value={fields.line2}
          onChange={(event) => set('line2')(event.target.value)}
          autoComplete="address-line2"
          maxLength={200}
        />
      </Field>
      <Field label="Landmark (optional)" htmlFor={id('landmark')}>
        <Input
          value={fields.landmark}
          onChange={(event) => set('landmark')(event.target.value)}
          maxLength={100}
        />
      </Field>
      <Field label="Town or city" htmlFor={id('city')} required>
        <Input
          value={fields.city}
          onChange={(event) => set('city')(event.target.value)}
          autoComplete="address-level2"
          maxLength={100}
        />
      </Field>
      <Field label="State" htmlFor={id('state')} required>
        <Select
          value={fields.stateCode}
          onChange={(event) => set('stateCode')(event.target.value)}
          autoComplete="address-level1"
        >
          <option value="" disabled>
            Choose a state
          </option>
          {GST_STATES.map((state) => (
            <option key={state.code} value={state.code}>
              {state.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="PIN code" htmlFor={id('pincode')} required>
        <Input
          value={fields.pincode}
          onChange={(event) => set('pincode')(event.target.value.trim())}
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={6}
        />
      </Field>
      {showDefault && !address?.isDefault ? (
        <label
          htmlFor={id('default')}
          className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2"
        >
          <Checkbox
            id={id('default')}
            checked={makeDefault}
            onChange={(event) => setMakeDefault(event.target.checked)}
          />
          Make this my default address
        </label>
      ) : null}
      {problem ? (
        <Notice tone="danger" title={problem.message} className="sm:col-span-2">
          {problem.issues.length ? (
            <ul className="list-disc pl-5">
              {problem.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </Notice>
      ) : null}
      <div className="flex flex-wrap gap-3 sm:col-span-2">
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving...' : address ? 'Save changes' : 'Save address'}
        </Button>
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  )
}

/** +919812345678 as +91 98123 45678, the way people read it out. */
const readableMobile = (phone: string) =>
  phone.replace(/^\+91(\d{5})(\d{5})$/, '+91 $1 $2')

/** An address as lines of text, for a card or an order. */
export function AddressLines({
  address,
}: {
  address: {
    fullName: string
    phone: string
    line1: string
    line2: string | null
    landmark: string | null
    city: string
    stateName?: string
    stateCode: string
    pincode: string
  }
}) {
  const state =
    address.stateName ??
    GST_STATES.find((item) => item.code === address.stateCode)?.name ??
    address.stateCode
  return (
    <address className="grid gap-0.5 text-sm not-italic">
      <span className="font-semibold">{address.fullName}</span>
      <span className="break-words">{address.line1}</span>
      {address.line2 ? (
        <span className="break-words">{address.line2}</span>
      ) : null}
      {address.landmark ? (
        <span className="break-words">Near {address.landmark}</span>
      ) : null}
      <span>
        {address.city}, {state} {address.pincode}
      </span>
      <span className="text-muted">Mobile {readableMobile(address.phone)}</span>
    </address>
  )
}
