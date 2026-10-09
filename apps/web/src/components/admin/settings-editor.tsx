'use client'

import { useState, type FormEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card, Notice, StatusBadge } from '@/components/ui/feedback'
import { Checkbox, Field, Input, Textarea } from '@/components/ui/form-controls'
import {
  basisPointsToPercentInput,
  issuesFor,
  paiseToRupeeInput,
  parsePercentToBasisPoints,
  parseRupeesToPaise,
  parseWholeNumber,
  sourcePresentation,
  type AdminSetting,
  type CompanyDetails,
} from '@/lib/admin-settings'
import { ApiError, apiRequest } from '@/lib/api-client'
import { formatIndianDate } from '@/lib/format'

type SettingKey = AdminSetting['key']

type MutationState = {
  pending: boolean
  message: string | null
  error: string | null
  issues: string[]
}

const idleMutation: MutationState = {
  pending: false,
  message: null,
  error: null,
  issues: [],
}

function useSettingMutation(initialSetting: AdminSetting) {
  const [setting, setSetting] = useState(initialSetting)
  const [mutation, setMutation] = useState(idleMutation)

  async function save(value: unknown): Promise<AdminSetting | null> {
    setMutation({ ...idleMutation, pending: true })
    try {
      const response = await apiRequest<{ setting: AdminSetting }>(
        `/api/admin/settings/${setting.key}`,
        { method: 'PUT', json: { value } },
      )
      setSetting(response.setting)
      setMutation({
        ...idleMutation,
        message: `${settingLabel(setting.key)} was saved.`,
      })
      return response.setting
    } catch (cause) {
      if (cause instanceof ApiError) {
        if (cause.status === 401) {
          window.location.assign(
            '/sign-in?returnTo=%2Fadmin%2Fsettings&reason=session-ended',
          )
          return null
        }
        setMutation({
          ...idleMutation,
          error:
            cause.status === 503
              ? 'Configuration is unavailable. Complete the required administrator setup, then try again.'
              : cause.message,
          issues: cause.issues,
        })
        return null
      }
      setMutation({
        ...idleMutation,
        error:
          'The setting could not be saved. Check your connection and try again.',
      })
      return null
    }
  }

  function localError(message: string) {
    setMutation({ ...idleMutation, error: message })
  }

  return { setting, mutation, save, localError }
}

const labels: Record<SettingKey, string> = {
  commission_bps: 'Marketplace commission',
  delivery_charge_paise: 'Delivery charge',
  free_delivery_threshold_paise: 'Free delivery threshold',
  cod_enabled: 'Cash on delivery',
  payment_timeout_minutes: 'Payment timeout',
  ai_daily_limit_platform: 'Platform daily AI limit',
  ai_daily_limit_seller: 'Seller daily AI limit',
  prohibited_terms: 'Prohibited listing terms',
  company_details: 'Company details',
}

function settingLabel(key: SettingKey): string {
  return labels[key]
}

function SettingCard({
  setting,
  mutation,
  children,
  onSubmit,
}: {
  setting: AdminSetting
  mutation: MutationState
  children: ReactNode
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const source = sourcePresentation(setting.source)
  return (
    <Card className="p-0">
      <form onSubmit={onSubmit} noValidate>
        <div className="grid gap-3 border-b p-5 sm:grid-cols-[1fr_auto] sm:items-start">
          <div>
            <h3 className="text-lg font-semibold">
              {settingLabel(setting.key)}
            </h3>
            <p className="mt-1 text-sm text-muted">{setting.description}</p>
          </div>
          <StatusBadge tone={source.tone}>{source.label}</StatusBadge>
          <p className="text-sm text-muted sm:col-span-2">
            {source.explanation}
          </p>
        </div>
        <div className="grid gap-4 p-5">{children}</div>
        {mutation.error ? (
          <Notice title={mutation.error} tone="danger" className="mx-5 mb-5">
            {mutation.issues.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5">
                {mutation.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            ) : null}
          </Notice>
        ) : null}
        {mutation.message ? (
          <Notice tone="success" className="mx-5 mb-5">
            {mutation.message}
          </Notice>
        ) : null}
        <div className="flex flex-col gap-3 border-t bg-surface-subtle p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">
            {setting.updatedAt
              ? `Last saved ${formatIndianDate(setting.updatedAt, { includeTime: true })}`
              : 'This setting has not been saved yet.'}
          </p>
          <Button type="submit" disabled={mutation.pending}>
            {mutation.pending ? 'Saving...' : 'Save this setting'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

function DecimalEditor({
  initialSetting,
  kind,
}: {
  initialSetting: AdminSetting
  kind: 'money' | 'percentage'
}) {
  const state = useSettingMutation(initialSetting)
  const [value, setValue] = useState(() =>
    kind === 'money'
      ? paiseToRupeeInput(initialSetting.value)
      : basisPointsToPercentInput(initialSetting.value),
  )
  const id = `setting-${initialSetting.key}`
  const fieldIssues = state.mutation.issues

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed =
      kind === 'money'
        ? parseRupeesToPaise(value)
        : parsePercentToBasisPoints(value)
    if (!parsed.ok) {
      state.localError(parsed.error)
      return
    }
    const saved = await state.save(parsed.value)
    if (saved) {
      setValue(
        kind === 'money'
          ? paiseToRupeeInput(saved.value)
          : basisPointsToPercentInput(saved.value),
      )
    }
  }

  return (
    <SettingCard {...state} onSubmit={submit}>
      <Field
        label={kind === 'money' ? 'Amount in rupees' : 'Percentage'}
        htmlFor={id}
        hint={
          kind === 'money'
            ? 'Enter rupees with up to two decimal places, for example 49 or 49.50.'
            : 'Enter a value from 0 to 100 with up to two decimal places.'
        }
        error={fieldIssues[0]}
        required
      >
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          inputMode="decimal"
          placeholder={kind === 'money' ? '49.00' : '10'}
          disabled={state.mutation.pending}
        />
      </Field>
    </SettingCard>
  )
}

function WholeNumberEditor({
  initialSetting,
  minimum = 0,
  maximum,
}: {
  initialSetting: AdminSetting
  minimum?: number
  maximum?: number
}) {
  const state = useSettingMutation(initialSetting)
  const [value, setValue] = useState(() =>
    typeof initialSetting.value === 'number'
      ? String(initialSetting.value)
      : '',
  )
  const id = `setting-${initialSetting.key}`

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = parseWholeNumber(value, settingLabel(initialSetting.key))
    if (!parsed.ok) {
      state.localError(parsed.error)
      return
    }
    const saved = await state.save(parsed.value)
    if (saved && typeof saved.value === 'number') {
      setValue(String(saved.value))
    }
  }

  return (
    <SettingCard {...state} onSubmit={submit}>
      <Field
        label="Whole-number value"
        htmlFor={id}
        hint={
          maximum === undefined
            ? `Enter ${minimum} or more.`
            : `Enter a whole number from ${minimum} to ${maximum}.`
        }
        error={state.mutation.issues[0]}
        required
      >
        <Input
          type="number"
          inputMode="numeric"
          min={minimum}
          max={maximum}
          step="1"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={state.mutation.pending}
        />
      </Field>
    </SettingCard>
  )
}

function BooleanEditor({ initialSetting }: { initialSetting: AdminSetting }) {
  const state = useSettingMutation(initialSetting)
  const [checked, setChecked] = useState(initialSetting.value === true)

  return (
    <SettingCard
      {...state}
      onSubmit={(event) => {
        event.preventDefault()
        void state.save(checked)
      }}
    >
      <label
        htmlFor="setting-cod-enabled"
        className="flex min-h-11 items-center gap-3 rounded-lg border bg-surface-subtle px-4 py-3"
      >
        <Checkbox
          id="setting-cod-enabled"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
          disabled={state.mutation.pending}
        />
        <span>
          <span className="block font-medium">Allow cash on delivery</span>
          <span className="block text-sm text-muted">
            Buyers can select cash on delivery during checkout when enabled.
          </span>
        </span>
      </label>
    </SettingCard>
  )
}

function TermsEditor({ initialSetting }: { initialSetting: AdminSetting }) {
  const state = useSettingMutation(initialSetting)
  const [value, setValue] = useState(() =>
    Array.isArray(initialSetting.value)
      ? initialSetting.value
          .filter((term): term is string => typeof term === 'string')
          .join('\n')
      : '',
  )

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const terms = value
      .split(/\r?\n/)
      .map((term) => term.trim())
      .filter(Boolean)
    const saved = await state.save(terms)
    if (saved && Array.isArray(saved.value)) {
      setValue(
        saved.value
          .filter((term): term is string => typeof term === 'string')
          .join('\n'),
      )
    }
  }

  return (
    <SettingCard {...state} onSubmit={submit}>
      <Field
        label="Words and phrases"
        htmlFor="setting-prohibited-terms"
        hint="Enter one word or phrase per line. Blank lines are ignored."
        error={state.mutation.issues[0]}
      >
        <Textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={'restricted phrase\nanother term'}
          disabled={state.mutation.pending}
          rows={8}
        />
      </Field>
    </SettingCard>
  )
}

const emptyCompany: CompanyDetails = {
  legalName: '',
  displayName: '',
  gstin: '',
  pan: '',
  address: { line1: '', line2: null, city: '', stateCode: '', pincode: '' },
  supportEmail: '',
  supportPhone: '',
  grievanceOfficer: { name: '', email: '', phone: '' },
}

function stringValue(value: unknown, key: string): string {
  const found = objectValue(value, key)
  return typeof found === 'string' ? found : ''
}

function objectValue(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined
  return Object.entries(value).find(([entryKey]) => entryKey === key)?.[1]
}

function companyFromUnknown(value: unknown): CompanyDetails {
  if (value === null) return structuredClone(emptyCompany)
  const address = objectValue(value, 'address')
  const grievance = objectValue(value, 'grievanceOfficer')
  return {
    legalName: stringValue(value, 'legalName'),
    displayName: stringValue(value, 'displayName'),
    gstin: stringValue(value, 'gstin'),
    pan: stringValue(value, 'pan'),
    address: {
      line1: stringValue(address, 'line1'),
      line2: stringValue(address, 'line2') || null,
      city: stringValue(address, 'city'),
      stateCode: stringValue(address, 'stateCode'),
      pincode: stringValue(address, 'pincode'),
    },
    supportEmail: stringValue(value, 'supportEmail'),
    supportPhone: stringValue(value, 'supportPhone'),
    grievanceOfficer: {
      name: stringValue(grievance, 'name'),
      email: stringValue(grievance, 'email'),
      phone: stringValue(grievance, 'phone'),
    },
  }
}

type CompanyPath =
  | keyof Omit<CompanyDetails, 'address' | 'grievanceOfficer'>
  | `address.${keyof CompanyDetails['address']}`
  | `grievanceOfficer.${keyof CompanyDetails['grievanceOfficer']}`

type CompanyTextKey = keyof Omit<CompanyDetails, 'address' | 'grievanceOfficer'>

function CompanyEditor({ initialSetting }: { initialSetting: AdminSetting }) {
  const state = useSettingMutation(initialSetting)
  const [details, setDetails] = useState(() =>
    companyFromUnknown(initialSetting.value),
  )

  function updateCompany(key: CompanyTextKey, value: string) {
    setDetails((current) => ({ ...current, [key]: value }))
  }

  function updateAddress(key: keyof CompanyDetails['address'], value: string) {
    setDetails((current) => ({
      ...current,
      address: {
        ...current.address,
        [key]: value || (key === 'line2' ? null : ''),
      },
    }))
  }

  function updateGrievance(
    key: keyof CompanyDetails['grievanceOfficer'],
    value: string,
  ) {
    setDetails((current) => ({
      ...current,
      grievanceOfficer: { ...current.grievanceOfficer, [key]: value },
    }))
  }

  const field = (
    path: CompanyPath,
    label: string,
    value: string | null,
    onChange: (value: string) => void,
    options: { autoComplete?: string; hint?: string; required?: boolean } = {},
  ) => {
    const id = `company-${path.replace('.', '-')}`
    const errors = issuesFor(state.mutation.issues, path)
    return (
      <Field
        key={path}
        label={label}
        htmlFor={id}
        hint={options.hint}
        error={errors.join('. ') || undefined}
        required={options.required ?? true}
      >
        <Input
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={options.autoComplete}
          disabled={state.mutation.pending}
        />
      </Field>
    )
  }

  return (
    <SettingCard
      {...state}
      onSubmit={async (event) => {
        event.preventDefault()
        const saved = await state.save(details)
        if (saved) setDetails(companyFromUnknown(saved.value))
      }}
    >
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 font-semibold sm:col-span-2">
          Legal identity
        </legend>
        {field(
          'legalName',
          'Legal name',
          details.legalName,
          (value) => updateCompany('legalName', value),
          { autoComplete: 'organization' },
        )}
        {field('displayName', 'Display name', details.displayName, (value) =>
          updateCompany('displayName', value),
        )}
        {field(
          'gstin',
          'GSTIN',
          details.gstin,
          (value) => updateCompany('gstin', value),
          { hint: 'For example, 27AAACE1234F1Z5.' },
        )}
        {field(
          'pan',
          'PAN',
          details.pan,
          (value) => updateCompany('pan', value),
          { hint: 'For example, AAACE1234F.' },
        )}
      </fieldset>
      <fieldset className="grid gap-4 border-t pt-5 sm:grid-cols-2">
        <legend className="mb-3 font-semibold sm:col-span-2">
          Registered address
        </legend>
        {field(
          'address.line1',
          'Address line 1',
          details.address.line1,
          (value) => updateAddress('line1', value),
          { autoComplete: 'address-line1' },
        )}
        {field(
          'address.line2',
          'Address line 2',
          details.address.line2,
          (value) => updateAddress('line2', value),
          { autoComplete: 'address-line2', required: false },
        )}
        {field(
          'address.city',
          'City',
          details.address.city,
          (value) => updateAddress('city', value),
          { autoComplete: 'address-level2' },
        )}
        {field(
          'address.stateCode',
          'GST state code',
          details.address.stateCode,
          (value) => updateAddress('stateCode', value),
          { hint: 'Two digits, for example 27 for Maharashtra.' },
        )}
        {field(
          'address.pincode',
          'PIN code',
          details.address.pincode,
          (value) => updateAddress('pincode', value),
          { autoComplete: 'postal-code' },
        )}
      </fieldset>
      <fieldset className="grid gap-4 border-t pt-5 sm:grid-cols-2">
        <legend className="mb-3 font-semibold sm:col-span-2">
          Customer support
        </legend>
        {field(
          'supportEmail',
          'Support email',
          details.supportEmail,
          (value) => updateCompany('supportEmail', value),
          { autoComplete: 'email' },
        )}
        {field(
          'supportPhone',
          'Support phone',
          details.supportPhone,
          (value) => updateCompany('supportPhone', value),
          {
            autoComplete: 'tel',
            hint: 'Use international format, for example +919812345678.',
          },
        )}
      </fieldset>
      <fieldset className="grid gap-4 border-t pt-5 sm:grid-cols-2">
        <legend className="mb-3 font-semibold sm:col-span-2">
          Grievance officer
        </legend>
        {field(
          'grievanceOfficer.name',
          'Name',
          details.grievanceOfficer.name,
          (value) => updateGrievance('name', value),
          { autoComplete: 'name' },
        )}
        {field(
          'grievanceOfficer.email',
          'Email',
          details.grievanceOfficer.email,
          (value) => updateGrievance('email', value),
          { autoComplete: 'email' },
        )}
        {field(
          'grievanceOfficer.phone',
          'Phone',
          details.grievanceOfficer.phone,
          (value) => updateGrievance('phone', value),
          {
            autoComplete: 'tel',
            hint: 'Use international format, for example +919812345678.',
          },
        )}
      </fieldset>
    </SettingCard>
  )
}

export function SettingsEditor({ settings }: { settings: AdminSetting[] }) {
  return (
    <div className="grid gap-10">
      <SettingSection
        id="commerce"
        title="Commerce"
        description="Set the marketplace commission and delivery amounts used for orders."
      >
        {settingsFor(settings, 'commission_bps').map((setting) => (
          <DecimalEditor
            key={setting.key}
            initialSetting={setting}
            kind="percentage"
          />
        ))}
        {settingsFor(
          settings,
          'delivery_charge_paise',
          'free_delivery_threshold_paise',
        ).map((setting) => (
          <DecimalEditor
            key={setting.key}
            initialSetting={setting}
            kind="money"
          />
        ))}
      </SettingSection>
      <SettingSection
        id="payments"
        title="Payments"
        description="Control payment choices and how long unpaid online orders hold stock."
      >
        {settingsFor(settings, 'cod_enabled').map((setting) => (
          <BooleanEditor key={setting.key} initialSetting={setting} />
        ))}
        {settingsFor(settings, 'payment_timeout_minutes').map((setting) => (
          <WholeNumberEditor
            key={setting.key}
            initialSetting={setting}
            minimum={5}
            maximum={120}
          />
        ))}
      </SettingSection>
      <SettingSection
        id="ai-limits"
        title="AI limits"
        description="Limit daily AI requests for the platform and for each seller. Zero disables requests."
      >
        {settingsFor(
          settings,
          'ai_daily_limit_platform',
          'ai_daily_limit_seller',
        ).map((setting) => (
          <WholeNumberEditor key={setting.key} initialSetting={setting} />
        ))}
      </SettingSection>
      <SettingSection
        id="moderation"
        title="Moderation"
        description="Maintain terms that flag catalogue listings for administrator review."
      >
        {settingsFor(settings, 'prohibited_terms').map((setting) => (
          <TermsEditor key={setting.key} initialSetting={setting} />
        ))}
      </SettingSection>
      <SettingSection
        id="company"
        title="Company details"
        description="These legal and contact details appear on the storefront and commission invoices."
      >
        {settingsFor(settings, 'company_details').map((setting) => (
          <CompanyEditor key={setting.key} initialSetting={setting} />
        ))}
      </SettingSection>
    </div>
  )
}

function settingsFor(settings: AdminSetting[], ...keys: SettingKey[]) {
  return keys.flatMap((key) =>
    settings.filter((setting) => setting.key === key),
  )
}

function SettingSection({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section aria-labelledby={`${id}-title`} className="scroll-mt-6">
      <h2 id={`${id}-title`} className="text-xl font-semibold">
        {title}
      </h2>
      <p className="mt-1 text-sm text-muted">{description}</p>
      <div className="mt-4 grid gap-5">{children}</div>
    </section>
  )
}
