'use client'

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Card, Notice, StatusBadge } from '@/components/ui/feedback'
import { Checkbox, Field, Input } from '@/components/ui/form-controls'
import { ApiError, apiRequest } from '@/lib/api-client'
import {
  canEditListing,
  serialiseVariantChanges,
  variantValues,
  type ProductVariant,
  type SellerProduct,
  type VariantEditValues,
} from '@/lib/product-editor'

type Feedback = {
  error: string | null
  issues: string[]
  conflict: boolean
  success: string | null
}

const idle: Feedback = {
  error: null,
  issues: [],
  conflict: false,
  success: null,
}

export function ProductVariantsEditor({
  product,
  onProduct,
  onReload,
}: {
  product: SellerProduct
  onProduct: (product: SellerProduct) => void
  onReload: () => Promise<void>
}) {
  const identityEditable = canEditListing(product.status)
  const [adding, setAdding] = useState(false)
  const [addValues, setAddValues] = useState<VariantEditValues>({
    sku: '',
    optionValues: product.optionNames.map(() => ''),
    priceRupees: '',
    mrpRupees: '',
    stock: '0',
    isActive: true,
  })
  const [addFeedback, setAddFeedback] = useState(idle)

  async function addVariant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const initial: VariantEditValues = {
      sku: '',
      optionValues: product.optionNames.map(() => ''),
      priceRupees: '',
      mrpRupees: '',
      stock: '',
      isActive: !addValues.isActive,
    }
    const input = serialiseVariantChanges(
      initial,
      addValues,
      product.optionNames,
      true,
    )
    if (!input.ok) {
      setAddFeedback({ ...idle, error: input.error, issues: input.issues })
      return
    }
    setAdding(true)
    setAddFeedback(idle)
    try {
      const response = await apiRequest<{ product: SellerProduct }>(
        `/api/seller/products/${product.id}/variants`,
        { method: 'POST', json: input.value },
      )
      onProduct(response.product)
      setAddValues({
        sku: '',
        optionValues: product.optionNames.map(() => ''),
        priceRupees: '',
        mrpRupees: '',
        stock: '0',
        isActive: true,
      })
      setAddFeedback({ ...idle, success: 'Variant added.' })
    } catch (cause) {
      setAddFeedback(feedbackFromError(cause, product.id))
    } finally {
      setAdding(false)
    }
  }

  return (
    <section aria-labelledby="variants-title" className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="variants-title" className="text-xl font-semibold">
            Variants, price, and stock
          </h2>
          <p className="mt-1 text-sm text-muted">
            Price, MRP, stock, and active state can change at every product
            status. SKU and options follow listing edit permissions.
          </p>
        </div>
        <StatusBadge>{product.variants.length} variants</StatusBadge>
      </div>

      <div className="grid gap-4">
        {product.variants.map((variant, index) => (
          <ExistingVariantEditor
            key={JSON.stringify(variant)}
            product={product}
            variant={variant}
            index={index}
            identityEditable={identityEditable}
            canDelete={identityEditable && product.variants.length > 1}
            onProduct={onProduct}
            onReload={onReload}
          />
        ))}
      </div>

      {identityEditable && product.optionNames.length > 0 ? (
        <Card className="p-0">
          <form onSubmit={addVariant} noValidate>
            <div className="border-b p-5">
              <h3 className="text-lg font-semibold">Add variant</h3>
              <p className="mt-1 text-sm text-muted">
                The new SKU and option combination must be unique in this
                product.
              </p>
            </div>
            <div className="p-5">
              <VariantFields
                prefix="new-variant"
                values={addValues}
                optionNames={product.optionNames}
                identityEditable
                disabled={adding}
                issues={addFeedback.issues}
                onChange={(values) => {
                  setAddValues(values)
                  setAddFeedback(idle)
                }}
              />
            </div>
            {addFeedback.error ? (
              <FeedbackNotice feedback={addFeedback} onReload={onReload} />
            ) : null}
            {addFeedback.success ? (
              <Notice tone="success" className="mx-5 mb-5">
                {addFeedback.success}
              </Notice>
            ) : null}
            <div className="flex justify-end border-t bg-surface-subtle p-5">
              <Button type="submit" disabled={adding}>
                {adding ? 'Adding variant...' : 'Add variant'}
              </Button>
            </div>
          </form>
        </Card>
      ) : identityEditable ? (
        <Notice>
          A product without option names has exactly one variant. Option names
          cannot be added after creation.
        </Notice>
      ) : null}
    </section>
  )
}

function ExistingVariantEditor({
  product,
  variant,
  index,
  identityEditable,
  canDelete,
  onProduct,
  onReload,
}: {
  product: SellerProduct
  variant: ProductVariant
  index: number
  identityEditable: boolean
  canDelete: boolean
  onProduct: (product: SellerProduct) => void
  onReload: () => Promise<void>
}) {
  const initial = variantValues(variant, product.optionNames)
  const [values, setValues] = useState(initial)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState(idle)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = serialiseVariantChanges(
      initial,
      values,
      product.optionNames,
      identityEditable,
    )
    if (!input.ok) {
      setFeedback({ ...idle, error: input.error, issues: input.issues })
      return
    }
    if (!input.value) {
      setFeedback({ ...idle, error: 'Change at least one variant field.' })
      return
    }
    setPending(true)
    setFeedback(idle)
    try {
      const response = await apiRequest<{ product: SellerProduct }>(
        `/api/seller/products/${product.id}/variants/${variant.id}`,
        { method: 'PATCH', json: input.value },
      )
      onProduct(response.product)
    } catch (cause) {
      setFeedback(feedbackFromError(cause, product.id))
    } finally {
      setPending(false)
    }
  }

  async function remove() {
    setPending(true)
    setFeedback(idle)
    try {
      const response = await apiRequest<{ product: SellerProduct }>(
        `/api/seller/products/${product.id}/variants/${variant.id}`,
        { method: 'DELETE' },
      )
      onProduct(response.product)
    } catch (cause) {
      setFeedback(feedbackFromError(cause, product.id))
    } finally {
      setPending(false)
    }
  }

  return (
    <Card className="p-0">
      <form onSubmit={save} noValidate>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b p-5">
          <div>
            <h3 className="font-semibold">Variant {index + 1}</h3>
            <p className="mt-1 break-all text-sm text-muted">{variant.sku}</p>
          </div>
          <StatusBadge tone={variant.isActive ? 'success' : 'warning'}>
            {variant.isActive ? 'Active' : 'Inactive'}
          </StatusBadge>
        </div>
        <div className="p-5">
          <VariantFields
            prefix={`variant-${variant.id}`}
            values={values}
            optionNames={product.optionNames}
            identityEditable={identityEditable}
            disabled={pending}
            issues={feedback.issues}
            onChange={(nextValues) => {
              setValues(nextValues)
              setFeedback(idle)
            }}
          />
        </div>
        {feedback.error ? (
          <FeedbackNotice feedback={feedback} onReload={onReload} />
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-surface-subtle p-5">
          <div>
            {canDelete ? (
              <ConfirmationDialog
                title={`Delete ${variant.sku}?`}
                description="Photos linked to this variant stay with the product. A variant used by an order or cart must be deactivated instead."
                trigger="Delete variant"
                triggerVariant="danger"
                confirmLabel="Delete variant"
                onConfirm={() => void remove()}
                danger
                triggerDisabled={pending}
                confirmDisabled={pending}
              />
            ) : (
              <p className="text-sm text-muted">
                {product.variants.length === 1
                  ? 'A product must keep at least one variant.'
                  : 'Variant identity and deletion are locked at this status.'}
              </p>
            )}
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving variant...' : 'Save variant'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

function VariantFields({
  prefix,
  values,
  optionNames,
  identityEditable,
  disabled,
  issues,
  onChange,
}: {
  prefix: string
  values: VariantEditValues
  optionNames: string[]
  identityEditable: boolean
  disabled: boolean
  issues: string[]
  onChange: (values: VariantEditValues) => void
}) {
  const error = (path: string) =>
    issues
      .filter((issue) => issue === path || issue.startsWith(`${path} `))
      .join('. ') || undefined
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Field
        label="SKU"
        htmlFor={`${prefix}-sku`}
        error={error('sku')}
        required
        className="sm:col-span-2 lg:col-span-4"
      >
        <Input
          value={values.sku}
          onChange={(event) => onChange({ ...values, sku: event.target.value })}
          maxLength={64}
          disabled={disabled || !identityEditable}
        />
      </Field>
      {optionNames.map((name, index) => (
        <Field
          key={name}
          label={name}
          htmlFor={`${prefix}-option-${index}`}
          error={error('options')}
          required
        >
          <Input
            value={values.optionValues[index] ?? ''}
            onChange={(event) =>
              onChange({
                ...values,
                optionValues: values.optionValues.map((value, itemIndex) =>
                  itemIndex === index ? event.target.value : value,
                ),
              })
            }
            maxLength={50}
            disabled={disabled || !identityEditable}
          />
        </Field>
      ))}
      <Field
        label="Selling price (₹)"
        htmlFor={`${prefix}-price`}
        error={error('pricePaise')}
        required
      >
        <Input
          value={values.priceRupees}
          onChange={(event) =>
            onChange({ ...values, priceRupees: event.target.value })
          }
          inputMode="decimal"
          disabled={disabled}
        />
      </Field>
      <Field
        label="MRP (₹)"
        htmlFor={`${prefix}-mrp`}
        error={error('mrpPaise')}
        required
      >
        <Input
          value={values.mrpRupees}
          onChange={(event) =>
            onChange({ ...values, mrpRupees: event.target.value })
          }
          inputMode="decimal"
          disabled={disabled}
        />
      </Field>
      <Field
        label="Stock"
        htmlFor={`${prefix}-stock`}
        error={error('stock')}
        required
      >
        <Input
          type="number"
          value={values.stock}
          onChange={(event) =>
            onChange({ ...values, stock: event.target.value })
          }
          inputMode="numeric"
          min="0"
          max="1000000"
          step="1"
          disabled={disabled}
        />
      </Field>
      <label
        htmlFor={`${prefix}-active`}
        className="flex min-h-11 items-center gap-3 rounded-lg border bg-surface-subtle px-4 py-3"
      >
        <Checkbox
          id={`${prefix}-active`}
          checked={values.isActive}
          onChange={(event) =>
            onChange({ ...values, isActive: event.target.checked })
          }
          disabled={disabled}
        />
        <span className="font-medium">Active variant</span>
      </label>
    </div>
  )
}

function feedbackFromError(cause: unknown, productId: string): Feedback {
  if (cause instanceof ApiError) {
    if (cause.status === 401) {
      window.location.assign(
        `/sign-in?returnTo=${encodeURIComponent(`/seller/products/${productId}`)}&reason=session-ended`,
      )
    }
    return {
      error: cause.message,
      issues: cause.issues,
      conflict: cause.status === 409,
      success: null,
    }
  }
  return {
    ...idle,
    error: 'The variant change failed. Check your connection and try again.',
  }
}

function FeedbackNotice({
  feedback,
  onReload,
}: {
  feedback: Feedback
  onReload: () => Promise<void>
}) {
  return (
    <Notice
      title={feedback.error ?? undefined}
      tone="danger"
      className="mx-5 mb-5"
    >
      {feedback.issues.length ? (
        <ul className="list-disc space-y-1 pl-5">
          {feedback.issues.map((issue, index) => (
            <li key={`${issue}-${index}`}>{issue}</li>
          ))}
        </ul>
      ) : null}
      {feedback.conflict ? (
        <Button
          variant="secondary"
          className="mt-3"
          onClick={() => void onReload()}
        >
          Reload server product
        </Button>
      ) : null}
    </Notice>
  )
}
