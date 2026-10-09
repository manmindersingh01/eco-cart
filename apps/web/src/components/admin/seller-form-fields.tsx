import { Field, Input } from '@/components/ui/form-controls'
import { issuesFor } from '@/lib/admin-settings'
import type { BusinessFormValues } from '@/lib/admin-sellers'

export function SellerBusinessFields({
  values,
  issues,
  disabled,
  onChange,
}: {
  values: BusinessFormValues
  issues: readonly string[]
  disabled: boolean
  onChange: (key: keyof BusinessFormValues, value: string) => void
}) {
  const error = (path: string) =>
    issuesFor(issues, path).join('. ') || undefined

  return (
    <div className="grid gap-7">
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 font-semibold sm:col-span-2">
          Business identity
        </legend>
        <Field
          label="Display name"
          htmlFor="seller-display-name"
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
          hint="Optional while pending. Required before approval."
          error={error('gstin')}
        >
          <Input
            value={values.gstin}
            onChange={(event) => onChange('gstin', event.target.value)}
            placeholder="27AAACE1234F1Z5"
            disabled={disabled}
          />
        </Field>
        <Field
          label="PAN"
          htmlFor="seller-pan"
          hint="Optional while pending. It must match the PAN inside the GSTIN."
          error={error('pan')}
        >
          <Input
            value={values.pan}
            onChange={(event) => onChange('pan', event.target.value)}
            placeholder="AAACE1234F"
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
          label="GST state code"
          htmlFor="seller-state-code"
          hint="Two digits, for example 27 for Maharashtra."
          error={error('stateCode')}
          required
        >
          <Input
            value={values.stateCode}
            onChange={(event) => onChange('stateCode', event.target.value)}
            inputMode="numeric"
            maxLength={2}
            disabled={disabled}
          />
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
          Invoicing and commission
        </legend>
        <Field
          label="Invoice prefix"
          htmlFor="seller-invoice-prefix"
          hint="Use 1 to 6 capital letters or digits. It cannot change after the first invoice."
          error={error('invoicePrefix')}
          required
        >
          <Input
            value={values.invoicePrefix}
            onChange={(event) => onChange('invoicePrefix', event.target.value)}
            maxLength={6}
            disabled={disabled}
          />
        </Field>
        <Field
          label="Seller commission percentage"
          htmlFor="seller-commission"
          hint="Leave blank to use the platform commission."
          error={error('commissionBps')}
        >
          <Input
            value={values.commissionPercent}
            onChange={(event) =>
              onChange('commissionPercent', event.target.value)
            }
            inputMode="decimal"
            placeholder="10"
            disabled={disabled}
          />
        </Field>
      </fieldset>
    </div>
  )
}
