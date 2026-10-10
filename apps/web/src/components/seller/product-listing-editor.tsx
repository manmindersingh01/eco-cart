'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { BrandPicker } from './product-create-form'
import { Button } from '@/components/ui/button'
import { Card, Notice, StatusBadge } from '@/components/ui/feedback'
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls'
import { issuesFor } from '@/lib/admin-settings'
import { ApiError, apiRequest } from '@/lib/api-client'
import {
  listingValues,
  serialiseListingChanges,
  type ListingFormValues,
  type SellerProduct,
} from '@/lib/product-editor'
import {
  flattenLeafCategories,
  type LeafCategory,
  type PublicBrand,
  type PublicCategory,
} from '@/lib/seller-products'

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

export function ProductListingEditor({
  product,
  onProduct,
  onReload,
}: {
  product: SellerProduct
  onProduct: (product: SellerProduct) => void
  onReload: () => Promise<void>
}) {
  const initial = listingValues(product)
  const [values, setValues] = useState(initial)
  const [categories, setCategories] = useState<LeafCategory[]>([])
  const [categoriesError, setCategoriesError] = useState<string | null>(null)
  const [categoryUrl, setCategoryUrl] = useState('/api/categories')
  const [selectedBrand, setSelectedBrand] = useState<PublicBrand | null>(
    product.brand ? { ...product.brand, slug: '' } : null,
  )
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState(idle)

  useEffect(() => {
    const controller = new AbortController()
    apiRequest<{ categories: PublicCategory[] }>(categoryUrl, {
      signal: controller.signal,
    })
      .then((response) => {
        setCategories(flattenLeafCategories(response.categories))
        return undefined
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        setCategoriesError(
          cause instanceof ApiError
            ? cause.message
            : 'Active categories could not be loaded.',
        )
      })
    return () => controller.abort()
  }, [categoryUrl])

  function change<K extends keyof ListingFormValues>(
    key: K,
    value: ListingFormValues[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }))
    setFeedback(idle)
  }

  const fieldError = (path: string) =>
    issuesFor(feedback.issues, path).join('. ') || undefined

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = serialiseListingChanges(initial, values)
    if (!input.ok) {
      setFeedback({ ...idle, error: input.error, issues: input.issues })
      return
    }
    if (!input.value) {
      setFeedback({ ...idle, error: 'Change at least one listing field.' })
      return
    }
    setPending(true)
    setFeedback(idle)
    try {
      const response = await apiRequest<{ product: SellerProduct }>(
        `/api/seller/products/${product.id}`,
        { method: 'PATCH', json: input.value },
      )
      onProduct(response.product)
    } catch (cause) {
      if (cause instanceof ApiError) {
        if (cause.status === 401) {
          window.location.assign(
            `/sign-in?returnTo=${encodeURIComponent(`/seller/products/${product.id}`)}&reason=session-ended`,
          )
          return
        }
        setFeedback({
          error: cause.message,
          issues: cause.issues,
          conflict: cause.status === 409,
          success: null,
        })
      } else {
        setFeedback({
          ...idle,
          error:
            'The listing could not be saved. Check your connection and try again.',
        })
      }
    } finally {
      setPending(false)
    }
  }

  const selectedCategoryExists = categories.some(
    (category) => category.id === values.categoryId,
  )

  return (
    <Card className="p-0">
      <form onSubmit={save} noValidate>
        <div className="border-b p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Listing details</h2>
              <p className="mt-1 text-sm text-muted">
                These fields and option names can change while the product is a
                draft or after rejection.
              </p>
            </div>
            <StatusBadge tone="success">Editable</StatusBadge>
          </div>
        </div>
        <div className="grid gap-6 p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Leaf category"
              htmlFor="edit-product-category"
              error={fieldError('categoryId') ?? categoriesError ?? undefined}
              required
              className="sm:col-span-2"
            >
              <Select
                value={values.categoryId}
                onChange={(event) => change('categoryId', event.target.value)}
                disabled={pending}
              >
                {!selectedCategoryExists ? (
                  <option value={values.categoryId}>
                    {product.category.path.join(' > ')} (current)
                  </option>
                ) : null}
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.path.join(' > ')}
                  </option>
                ))}
              </Select>
            </Field>
            {categoriesError ? (
              <div className="sm:col-span-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setCategoriesError(null)
                    setCategoryUrl(`/api/categories?retry=${Date.now()}`)
                  }}
                >
                  Retry active categories
                </Button>
              </div>
            ) : null}
            <Field
              label="Title"
              htmlFor="edit-product-title"
              error={fieldError('title')}
              required
              className="sm:col-span-2"
            >
              <Input
                value={values.title}
                onChange={(event) => change('title', event.target.value)}
                minLength={3}
                maxLength={150}
                disabled={pending}
              />
            </Field>
            <Field
              label="Description"
              htmlFor="edit-product-description"
              hint={`${values.description.length.toLocaleString('en-IN')} of 5,000 characters.`}
              error={fieldError('description')}
              className="sm:col-span-2"
            >
              <Textarea
                value={values.description}
                onChange={(event) => change('description', event.target.value)}
                maxLength={5000}
                rows={8}
                disabled={pending}
              />
            </Field>
            <Field
              label="HSN code"
              htmlFor="edit-product-hsn"
              hint="Blank uses the category default. Otherwise use 4, 6, or 8 digits."
              error={fieldError('hsnCode')}
            >
              <Input
                value={values.hsnCode}
                onChange={(event) => change('hsnCode', event.target.value)}
                inputMode="numeric"
                maxLength={8}
                disabled={pending}
              />
            </Field>
          </div>

          <BrandPicker
            selected={selectedBrand}
            selectedId={values.brandId}
            disabled={pending}
            issue={fieldError('brandId')}
            onSelect={(brand) => {
              setSelectedBrand(brand)
              change('brandId', brand?.id ?? '')
            }}
          />

          <EditableList
            title="Highlights"
            limit={8}
            values={values.highlights}
            disabled={pending}
            onChange={(highlights) => change('highlights', highlights)}
          />

          <section aria-labelledby="edit-attributes-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 id="edit-attributes-title" className="font-semibold">
                  Attributes
                </h3>
                <p className="mt-1 text-sm text-muted">
                  Up to 30 name and value pairs.
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={() =>
                  change('attributes', [
                    ...values.attributes,
                    { name: '', value: '' },
                  ])
                }
                disabled={pending || values.attributes.length >= 30}
              >
                Add attribute
              </Button>
            </div>
            <div className="mt-3 grid gap-3">
              {values.attributes.map((attribute, index) => (
                <div
                  key={index}
                  className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_auto]"
                >
                  <Field
                    label={`Attribute ${index + 1} name`}
                    htmlFor={`edit-attribute-name-${index}`}
                    error={fieldError(`attributes.${index}.name`)}
                  >
                    <Input
                      value={attribute.name}
                      onChange={(event) =>
                        change(
                          'attributes',
                          values.attributes.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, name: event.target.value }
                              : item,
                          ),
                        )
                      }
                      maxLength={40}
                      disabled={pending}
                    />
                  </Field>
                  <Field
                    label={`Attribute ${index + 1} value`}
                    htmlFor={`edit-attribute-value-${index}`}
                    error={fieldError(`attributes.${index}.value`)}
                  >
                    <Input
                      value={attribute.value}
                      onChange={(event) =>
                        change(
                          'attributes',
                          values.attributes.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, value: event.target.value }
                              : item,
                          ),
                        )
                      }
                      maxLength={200}
                      disabled={pending}
                    />
                  </Field>
                  <Button
                    variant="quiet"
                    className="sm:mt-7"
                    onClick={() =>
                      change(
                        'attributes',
                        values.attributes.filter(
                          (_, itemIndex) => itemIndex !== index,
                        ),
                      )
                    }
                    disabled={pending}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          </section>

          {values.optionNames.length > 0 ? (
            <fieldset className="grid gap-3 border-t pt-5 sm:grid-cols-3">
              <legend className="mb-2 font-semibold">
                Rename option fields
              </legend>
              {values.optionNames.map((name, index) => (
                <Field
                  key={index}
                  label={`Option ${index + 1}`}
                  htmlFor={`edit-option-name-${index}`}
                  error={fieldError(`optionNames.${index}`)}
                  required
                >
                  <Input
                    value={name}
                    onChange={(event) =>
                      change(
                        'optionNames',
                        values.optionNames.map((item, itemIndex) =>
                          itemIndex === index ? event.target.value : item,
                        ),
                      )
                    }
                    maxLength={30}
                    disabled={pending}
                  />
                </Field>
              ))}
            </fieldset>
          ) : null}
        </div>

        {feedback.error ? (
          <Notice
            title={feedback.error}
            tone="danger"
            className="mx-5 mb-5 sm:mx-6"
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
        ) : null}
        <div className="flex justify-end border-t bg-surface-subtle p-5 sm:p-6">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving listing...' : 'Save listing details'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

function EditableList({
  title,
  limit,
  values,
  disabled,
  onChange,
}: {
  title: string
  limit: number
  values: string[]
  disabled: boolean
  onChange: (values: string[]) => void
}) {
  const id = title.toLowerCase()
  return (
    <section aria-labelledby={`edit-${id}-title`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id={`edit-${id}-title`} className="font-semibold">
            {title}
          </h3>
          <p className="mt-1 text-sm text-muted">
            {values.length} of {limit}
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => onChange([...values, ''])}
          disabled={disabled || values.length >= limit}
        >
          Add highlight
        </Button>
      </div>
      <div className="mt-3 grid gap-3">
        {values.map((value, index) => (
          <div key={index} className="flex items-start gap-2">
            <Field
              label={`${title.slice(0, -1)} ${index + 1}`}
              htmlFor={`edit-${id}-${index}`}
              className="flex-1"
            >
              <Input
                value={value}
                onChange={(event) =>
                  onChange(
                    values.map((item, itemIndex) =>
                      itemIndex === index ? event.target.value : item,
                    ),
                  )
                }
                maxLength={200}
                disabled={disabled}
              />
            </Field>
            <Button
              variant="quiet"
              className="mt-7"
              onClick={() =>
                onChange(values.filter((_, itemIndex) => itemIndex !== index))
              }
              disabled={disabled}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>
    </section>
  )
}
