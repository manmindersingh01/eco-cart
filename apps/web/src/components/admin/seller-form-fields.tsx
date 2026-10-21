import { GST_STATES } from '@ecokart/core/states'
import { Field, Input, Select } from '@/components/ui/form-controls'
import { issuesFor } from '@/lib/admin-settings'
import type { BusinessFormValues } from '@/lib/admin-sellers'

/**
 * The business details of a seller. `application` is the form a buyer
 * fills in to apply to sell: it has no commission, and the invoice prefix
 * may be left blank for EcoKart to suggest one.
 */
export function SellerBusinessFields({
  values,
  issues,
  disabled,
  onChange,
  mode = 'admin',
}: {
  values: Omit<BusinessFormValues, 'commissionPercent'> &
    Partial<Pick<BusinessFormValues, 'commissionPercent'>>
  issues: readonly string[]
  disabled: boolean
  onChange: (key: keyof BusinessFormValues, value: string) => void
  mode?: 'admin' | 'application'
}) {
  const error = (path: string) =>
    issuesFor(issues, path).join('. ') || undefined
  const application = mode === 'application'

  return (
    <div className="grid gap-7">
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 font-semibold sm:col-span-2">
          Business identity
        </legend>
        <Field
          label="Display name"
          htmlFor="seller-display-name"
          hint={
            application ? 'The shop name buyers see on EcoKart.' : undefined
          }
          error={error('displayName')}
          required
        >
          <Input
            value={values.displayName}
            onChange={(event) => onChange('displayName', event.target.value)}
            autoComplete="organization"
            disabled={disabled}
          />
        </Field>
        <Field
          label="Legal name"
          htmlFor="seller-legal-name"
          hint={
            application
              ? 'As registered for GST, for example Green Basket Private Limited.'
              : undefined
          }
          error={error('legalName')}
          required
        >
          <Input
            value={values.legalName}
            onChange={(event) => onChange('legalName', event.target.value)}
            disabled={disabled}
          />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 border-t pt-6 sm:grid-cols-2">
        <legend className="mb-3 font-semibold sm:col-span-2">
          Tax details
        </legend>
        <Field
          label="GSTIN"
          htmlFor="seller-gstin"
          hint={
            application
              ? 'You can add it later, but we need it before approval.'
              : 'Optional while pending. Required before approval.'
          }
          error={error('gstin')}
        >
          <Input
            value={values.gstin}
            onChange={(event) => onChange('gstin', event.target.value)}
            placeholder="27AAACE1234F1Z5"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={disabled}
          />
        </Field>
        <Field
          label="PAN"
          htmlFor="seller-pan"
          hint={
            application
              ? 'Needed before approval. It is part of your GSTIN.'
              : 'Optional while pending. It must match the PAN inside the GSTIN.'
          }
          error={error('pan')}
        >
          <Input
            value={values.pan}
            onChange={(event) => onChange('pan', event.target.value)}
            placeholder="AAACE1234F"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={disabled}
          />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 border-t pt-6 sm:grid-cols-2">
        <legend className="mb-3 font-semibold sm:col-span-2">
          Registered address
        </legend>
        <Field
          label="Address line"
          htmlFor="seller-line1"
          error={error('line1')}
          className="sm:col-span-2"
          required
        >
          <Input
            value={values.line1}
            onChange={(event) => onChange('line1', event.target.value)}
            autoComplete="address-line1"
            disabled={disabled}
          />
        </Field>
        <Field
          label="City"
          htmlFor="seller-city"
          error={error('city')}
          required
        >
          <Input
            value={values.city}
            onChange={(event) => onChange('city', event.target.value)}
            autoComplete="address-level2"
            disabled={disabled}
          />
        </Field>
        <Field
          label="State"
          htmlFor="seller-state-code"
          hint="Your GSTIN starts with this state's code."
          error={error('stateCode')}
          required
        >
          <Select
            value={values.stateCode}
            onChange={(event) => onChange('stateCode', event.target.value)}
            autoComplete="address-level1"
            disabled={disabled}
          >
            <option value="" disabled>
              Choose a state
            </option>
            {GST_STATES.map((state) => (
              <option key={state.code} value={state.code}>
                {state.name} ({state.code})
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="PIN code"
          htmlFor="seller-pincode"
          error={error('pincode')}
          required
        >
          <Input
            value={values.pincode}
            onChange={(event) => onChange('pincode', event.target.value)}
            autoComplete="postal-code"
            inputMode="numeric"
            maxLength={6}
            disabled={disabled}
          />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 border-t pt-6 sm:grid-cols-2">
        <legend className="mb-3 font-semibold sm:col-span-2">
          Seller support
        </legend>
        <Field
          label="Support email"
          htmlFor="seller-support-email"
          error={error('supportEmail')}
          required
        >
          <Input
            type="email"
            value={values.supportEmail}
            onChange={(event) => onChange('supportEmail', event.target.value)}
            autoComplete="email"
            disabled={disabled}
          />
        </Field>
        <Field
          label="Support phone"
          htmlFor="seller-support-phone"
          hint="Use international format, for example +919812345678."
          error={error('supportPhone')}
          required
        >
          <Input
            type="tel"
            value={values.supportPhone}
            onChange={(event) => onChange('supportPhone', event.target.value)}
            autoComplete="tel"
            disabled={disabled}
          />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 border-t pt-6 sm:grid-cols-2">
        <legend className="mb-3 font-semibold sm:col-span-2">
          {application ? 'Invoicing' : 'Invoicing and commission'}
        </legend>
        <Field
          label="Invoice prefix"
          htmlFor="seller-invoice-prefix"
          hint={
            application
              ? 'Optional: 1 to 4 capital letters or digits that start your GST invoice numbers. Leave it blank and we will suggest one.'
              : 'Use 1 to 4 capital letters or digits. It cannot change after the first invoice.'
          }
          error={error('invoicePrefix')}
          required={!application}
        >
          <Input
            value={values.invoicePrefix}
            onChange={(event) => onChange('invoicePrefix', event.target.value)}
            maxLength={6}
            autoCapitalize="characters"
            spellCheck={false}
            disabled={disabled}
          />
        </Field>
        {application ? null : (
          <Field
            label="Seller commission percentage"
            htmlFor="seller-commission"
            hint="Leave blank to use the platform commission."
            error={error('commissionBps')}
          >
            <Input
              value={values.commissionPercent ?? ''}
              onChange={(event) =>
                onChange('commissionPercent', event.target.value)
              }
              inputMode="decimal"
              placeholder="10"
              disabled={disabled}
            />
          </Field>
        )}
      </fieldset>
    </div>
  )
}
