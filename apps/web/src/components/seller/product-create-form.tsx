'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button, LinkButton } from '@/components/ui/button'
import { Card, Notice, StatusBadge } from '@/components/ui/feedback'
import {
  Checkbox,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/ui/form-controls'
import { PageHeader } from '@/components/ui/page-header'
import { issuesFor } from '@/lib/admin-settings'
import { ApiError, apiRequest } from '@/lib/api-client'
import {
  flattenLeafCategories,
  serialiseProduct,
  type LeafCategory,
  type ProductFormValues,
  type PublicBrand,
  type PublicCategory,
  type VariantFormValue,
} from '@/lib/seller-products'

type Feedback = {
  error: string | null
  issues: string[]
}

const idleFeedback: Feedback = { error: null, issues: [] }

const initialValues: ProductFormValues = {
  categoryId: '',
  brandId: '',
  title: '',
  description: '',
  highlights: [],
  attributes: [],
  hsnCode: '',
  optionNames: [],
  variants: [
    {
      id: 'variant-1',
      sku: '',
      optionValues: [],
      priceRupees: '',
      mrpRupees: '',
      stock: '0',
      isActive: true,
    },
  ],
}

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`

export function ProductCreateForm() {
  const [values, setValues] = useState(initialValues)
  const [categories, setCategories] = useState<LeafCategory[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(true)
  const [categoriesError, setCategoriesError] = useState<string | null>(null)
  const [categoryRequestUrl, setCategoryRequestUrl] =
    useState('/api/categories')
  const [selectedBrand, setSelectedBrand] = useState<PublicBrand | null>(null)
  const [feedback, setFeedback] = useState(idleFeedback)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    apiRequest<{ categories: PublicCategory[] }>(categoryRequestUrl, {
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
            : 'Categories could not be loaded. Check your connection and try again.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setCategoriesLoading(false)
      })
    return () => controller.abort()
  }, [categoryRequestUrl])

  function change<K extends keyof ProductFormValues>(
    key: K,
    value: ProductFormValues[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }))
    setFeedback(idleFeedback)
  }

  function error(path: string): string | undefined {
    return issuesFor(feedback.issues, path).join('. ') || undefined
  }

  function addHighlight() {
    if (values.highlights.length >= 8) return
    change('highlights', [
      ...values.highlights,
      { id: newId('highlight'), value: '' },
    ])
  }

  function addAttribute() {
    if (values.attributes.length >= 30) return
    change('attributes', [
      ...values.attributes,
      { id: newId('attribute'), name: '', value: '' },
    ])
  }

  function addOptionName() {
    if (values.optionNames.length >= 3) return
    change('optionNames', [
      ...values.optionNames,
      { id: newId('option'), value: '' },
    ])
    setValues((current) => ({
      ...current,
      variants: current.variants.map((variant) => ({
        ...variant,
        optionValues: [...variant.optionValues, ''],
      })),
    }))
  }

  function removeOptionName(index: number) {
    setValues((current) => ({
      ...current,
      optionNames: current.optionNames.filter(
        (_, itemIndex) => itemIndex !== index,
      ),
      variants: current.variants.map((variant) => ({
        ...variant,
        optionValues: variant.optionValues.filter(
          (_, itemIndex) => itemIndex !== index,
        ),
      })),
    }))
    setFeedback(idleFeedback)
  }

  function addVariant() {
    if (values.variants.length >= 100 || values.optionNames.length === 0) return
    change('variants', [
      ...values.variants,
      {
        id: newId('variant'),
        sku: '',
        optionValues: values.optionNames.map(() => ''),
        priceRupees: '',
        mrpRupees: '',
        stock: '0',
        isActive: true,
      },
    ])
  }

  function updateVariant(
    index: number,
    update: (variant: VariantFormValue) => VariantFormValue,
  ) {
    change(
      'variants',
      values.variants.map((variant, itemIndex) =>
        itemIndex === index ? update(variant) : variant,
      ),
    )
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = serialiseProduct(values)
    if (!input.ok) {
      setFeedback({ error: input.error, issues: input.issues })
      return
    }
    setPending(true)
    setFeedback(idleFeedback)
    try {
      const response = await apiRequest<{ product: { id: string } }>(
        '/api/seller/products',
        { method: 'POST', json: input.value },
      )
      window.location.assign(
        `/seller/products?created=${encodeURIComponent(response.product.id)}`,
      )
    } catch (cause) {
      if (cause instanceof ApiError) {
        if (cause.status === 401) {
          window.location.assign(
            '/sign-in?returnTo=%2Fseller%2Fproducts%2Fnew&reason=session-ended',
          )
          return
        }
        if (cause.status === 403) {
          window.location.assign('/access-denied?area=seller&reason=wrong-role')
          return
        }
        setFeedback({ error: cause.message, issues: cause.issues })
      } else {
        setFeedback({
          error:
            'The draft could not be created. Check your connection and try again.',
          issues: [],
        })
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid gap-7">
      <PageHeader
        title="Create product draft"
        description="Start with product details, selling options, prices, and stock. You can add photos in the next step."
        actions={
          <LinkButton href="/seller/products" variant="secondary">
            Back to products
          </LinkButton>
        }
      />

      <form className="grid gap-6" onSubmit={submit} noValidate>
        <Card className="grid gap-5">
          <SectionHeading
            title="Product identity"
            description="Choose the most specific category and add the customer-facing product name."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Leaf category"
              htmlFor="product-category"
              hint="Only the lowest active categories are selectable. Paths distinguish categories with the same name."
              error={error('categoryId') ?? categoriesError ?? undefined}
              required
              className="sm:col-span-2"
            >
              <Select
                value={values.categoryId}
                onChange={(event) => change('categoryId', event.target.value)}
                disabled={
                  pending || categoriesLoading || Boolean(categoriesError)
                }
              >
                <option value="">
                  {categoriesLoading
                    ? 'Loading categories...'
                    : categories.length === 0
                      ? 'No active leaf categories available'
                      : 'Select a category'}
                </option>
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
                    setCategoriesLoading(true)
                    setCategoriesError(null)
                    setCategoryRequestUrl(`/api/categories?retry=${Date.now()}`)
                  }}
                  disabled={categoriesLoading}
                >
                  Retry categories
                </Button>
              </div>
            ) : null}
            <Field
              label="Product title"
              htmlFor="product-title"
              hint="Use 3 to 150 characters."
              error={error('title')}
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
              htmlFor="product-description"
              hint={`${values.description.length.toLocaleString('en-IN')} of 5,000 characters.`}
              error={error('description')}
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
              htmlFor="product-hsn"
              hint="Optional. Leave blank to use the category default. Use 4, 6, or 8 digits when supplied."
              error={error('hsnCode')}
            >
              <Input
                value={values.hsnCode}
                onChange={(event) => change('hsnCode', event.target.value)}
                inputMode="numeric"
                pattern="(?:[0-9]{4}|[0-9]{6}|[0-9]{8})"
                maxLength={8}
                disabled={pending}
              />
            </Field>
          </div>
          <BrandPicker
            selected={selectedBrand}
            selectedId={values.brandId}
            disabled={pending}
            issue={error('brandId')}
            onSelect={(brand) => {
              setSelectedBrand(brand)
              change('brandId', brand?.id ?? '')
            }}
          />
        </Card>

        <Card className="grid gap-5">
          <SectionHeading
            title="Highlights"
            description="Add up to eight short points customers can scan quickly."
            count={`${values.highlights.length} of 8`}
          />
          {values.highlights.map((highlight, index) => (
            <div key={highlight.id} className="flex items-start gap-2">
              <Field
                label={`Highlight ${index + 1}`}
                htmlFor={`product-highlight-${highlight.id}`}
                error={error(`highlights.${index}`)}
                className="flex-1"
              >
                <Input
                  value={highlight.value}
                  onChange={(event) =>
                    change(
                      'highlights',
                      values.highlights.map((item) =>
                        item.id === highlight.id
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
                className="mt-7"
                aria-label={`Remove highlight ${index + 1}`}
                onClick={() =>
                  change(
                    'highlights',
                    values.highlights.filter(
                      (item) => item.id !== highlight.id,
                    ),
                  )
                }
                disabled={pending}
              >
                Remove
              </Button>
            </div>
          ))}
          <div>
            <Button
              variant="secondary"
              onClick={addHighlight}
              disabled={pending || values.highlights.length >= 8}
            >
              Add highlight
            </Button>
          </div>
        </Card>

        <Card className="grid gap-5">
          <SectionHeading
            title="Attributes"
            description="Add up to 30 facts such as Material: Bamboo or Capacity: 2 litres."
            count={`${values.attributes.length} of 30`}
          />
          {values.attributes.map((attribute, index) => (
            <div
              key={attribute.id}
              className="grid gap-3 rounded-lg border bg-surface-subtle p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-start"
            >
              <Field
                label={`Attribute ${index + 1} name`}
                htmlFor={`attribute-name-${attribute.id}`}
                error={error(`attributes.${index}.name`)}
              >
                <Input
                  value={attribute.name}
                  onChange={(event) =>
                    change(
                      'attributes',
                      values.attributes.map((item) =>
                        item.id === attribute.id
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
                htmlFor={`attribute-value-${attribute.id}`}
                error={error(`attributes.${index}.value`)}
              >
                <Input
                  value={attribute.value}
                  onChange={(event) =>
                    change(
                      'attributes',
                      values.attributes.map((item) =>
                        item.id === attribute.id
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
                      (item) => item.id !== attribute.id,
                    ),
                  )
                }
                disabled={pending}
              >
                Remove
              </Button>
            </div>
          ))}
          <div>
            <Button
              variant="secondary"
              onClick={addAttribute}
              disabled={pending || values.attributes.length >= 30}
            >
              Add attribute
            </Button>
          </div>
        </Card>

        <Card className="grid gap-5">
          <SectionHeading
            title="Selling options"
            description="Leave this empty for one simple variant, or add up to three names such as Size and Colour. Renaming a field keeps every entered value in the same position."
            count={`${values.optionNames.length} of 3`}
          />
          {values.optionNames.map((option, index) => (
            <div key={option.id} className="flex items-start gap-2">
              <Field
                label={`Option name ${index + 1}`}
                htmlFor={`option-name-${option.id}`}
                error={error(`optionNames.${index}`)}
                className="flex-1"
              >
                <Input
                  value={option.value}
                  onChange={(event) =>
                    change(
                      'optionNames',
                      values.optionNames.map((item) =>
                        item.id === option.id
                          ? { ...item, value: event.target.value }
                          : item,
                      ),
                    )
                  }
                  maxLength={30}
                  disabled={pending}
                />
              </Field>
              <Button
                variant="quiet"
                className="mt-7"
                onClick={() => removeOptionName(index)}
                disabled={pending}
              >
                Remove
              </Button>
            </div>
          ))}
          <div>
            <Button
              variant="secondary"
              onClick={addOptionName}
              disabled={pending || values.optionNames.length >= 3}
            >
              Add option name
            </Button>
          </div>
        </Card>

        <Card className="grid gap-5">
          <SectionHeading
            title="Variants, price, and stock"
            description="Every variant needs a unique SKU and one value for each option name. Prices include GST."
            count={`${values.variants.length} of 100`}
          />
          {values.optionNames.length === 0 ? (
            <Notice>
              This simple product has one variant. Add an option name before
              adding more variants.
            </Notice>
          ) : null}
          <div className="grid gap-4">
            {values.variants.map((variant, index) => (
              <VariantEditor
                key={variant.id}
                variant={variant}
                index={index}
                optionNames={values.optionNames.map((option) => option.value)}
                disabled={pending}
                issues={feedback.issues}
                canRemove={values.variants.length > 1}
                onChange={(update) => updateVariant(index, update)}
                onRemove={() =>
                  change(
                    'variants',
                    values.variants.filter((item) => item.id !== variant.id),
                  )
                }
              />
            ))}
          </div>
          <div>
            <Button
              variant="secondary"
              onClick={addVariant}
              disabled={
                pending ||
                values.optionNames.length === 0 ||
                values.variants.length >= 100
              }
            >
              Add variant
            </Button>
          </div>
        </Card>

        {feedback.error ? (
          <Notice title={feedback.error} tone="danger">
            {feedback.issues.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5">
                {feedback.issues.map((issue, index) => (
                  <li key={`${issue}-${index}`}>{issue}</li>
                ))}
              </ul>
            ) : null}
          </Notice>
        ) : null}

        <div className="flex flex-col-reverse gap-3 rounded-xl border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">
            The draft remains private until the later review flow approves it.
          </p>
          <Button type="submit" disabled={pending || categoriesLoading}>
            {pending ? 'Creating draft...' : 'Create product draft'}
          </Button>
        </div>
      </form>
    </div>
  )
}

function SectionHeading({
  title,
  description,
  count,
}: {
  title: string
  description: string
  count?: string
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      {count ? <StatusBadge>{count}</StatusBadge> : null}
    </div>
  )
}

function VariantEditor({
  variant,
  index,
  optionNames,
  disabled,
  issues,
  canRemove,
  onChange,
  onRemove,
}: {
  variant: VariantFormValue
  index: number
  optionNames: string[]
  disabled: boolean
  issues: string[]
  canRemove: boolean
  onChange: (update: (variant: VariantFormValue) => VariantFormValue) => void
  onRemove: () => void
}) {
  const fieldError = (path: string) =>
    issuesFor(issues, `variants.${index}.${path}`).join('. ') || undefined
  return (
    <fieldset className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-4">
      <legend className="px-2 font-semibold">Variant {index + 1}</legend>
      <Field
        label="SKU"
        htmlFor={`variant-sku-${variant.id}`}
        hint="1 to 64 letters, digits, dots, hyphens, underscores, or slashes."
        error={fieldError('sku')}
        required
        className="sm:col-span-2 lg:col-span-4"
      >
        <Input
          value={variant.sku}
          onChange={(event) =>
            onChange((current) => ({ ...current, sku: event.target.value }))
          }
          pattern="[A-Za-z0-9][A-Za-z0-9._/-]{0,63}"
          maxLength={64}
          disabled={disabled}
        />
      </Field>
      {optionNames.map((name, optionIndex) => (
        <Field
          key={optionIndex}
          label={name.trim() || `Option ${optionIndex + 1}`}
          htmlFor={`variant-option-${variant.id}-${optionIndex}`}
          error={fieldError('options')}
          required
        >
          <Input
            value={variant.optionValues[optionIndex] ?? ''}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                optionValues: current.optionValues.map((value, itemIndex) =>
                  itemIndex === optionIndex ? event.target.value : value,
                ),
              }))
            }
            maxLength={50}
            disabled={disabled}
          />
        </Field>
      ))}
      <Field
        label="Selling price (₹)"
        htmlFor={`variant-price-${variant.id}`}
        hint="Up to ₹10,00,000 with two decimal places."
        error={fieldError('pricePaise')}
        required
      >
        <Input
          value={variant.priceRupees}
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              priceRupees: event.target.value,
            }))
          }
          inputMode="decimal"
          disabled={disabled}
        />
      </Field>
      <Field
        label="MRP (₹)"
        htmlFor={`variant-mrp-${variant.id}`}
        hint="Must be at least the selling price."
        error={fieldError('mrpPaise')}
        required
      >
        <Input
          value={variant.mrpRupees}
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              mrpRupees: event.target.value,
            }))
          }
          inputMode="decimal"
          disabled={disabled}
        />
      </Field>
      <Field
        label="Stock"
        htmlFor={`variant-stock-${variant.id}`}
        hint="A whole number from 0 to 10,00,000."
        error={fieldError('stock')}
        required
      >
        <Input
          type="number"
          value={variant.stock}
          onChange={(event) =>
            onChange((current) => ({ ...current, stock: event.target.value }))
          }
          inputMode="numeric"
          min="0"
          max="1000000"
          step="1"
          disabled={disabled}
        />
      </Field>
      <label
        htmlFor={`variant-active-${variant.id}`}
        className="flex min-h-11 items-center gap-3 rounded-lg border bg-surface-subtle px-4 py-3"
      >
        <Checkbox
          id={`variant-active-${variant.id}`}
          checked={variant.isActive}
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              isActive: event.target.checked,
            }))
          }
          disabled={disabled}
        />
        <span className="font-medium">Active variant</span>
      </label>
      {canRemove ? (
        <div className="sm:col-span-2 lg:col-span-4">
          <Button variant="quiet" onClick={onRemove} disabled={disabled}>
            Remove variant
          </Button>
        </div>
      ) : null}
    </fieldset>
  )
}

function BrandPicker({
  selected,
  selectedId,
  disabled,
  issue,
  onSelect,
}: {
  selected: PublicBrand | null
  selectedId: string
  disabled: boolean
  issue?: string
  onSelect: (brand: PublicBrand | null) => void
}) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<PublicBrand[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const request = useRef<AbortController | null>(null)

  useEffect(() => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    const timer = window.setTimeout(
      () => {
        setLoading(true)
        setLoadError(null)
        const params = new URLSearchParams({ limit: '10' })
        if (query.trim()) params.set('q', query.trim())
        apiRequest<{ items: PublicBrand[]; nextCursor: string | null }>(
          `/api/brands?${params}`,
          { signal: controller.signal },
        )
          .then((response) => {
            setItems(response.items)
            setNextCursor(response.nextCursor)
            return undefined
          })
          .catch((cause: unknown) => {
            if (cause instanceof DOMException && cause.name === 'AbortError')
              return
            setLoadError(
              cause instanceof ApiError
                ? cause.message
                : 'Brands could not be loaded. Check your connection and try again.',
            )
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false)
          })
      },
      query ? 300 : 0,
    )
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  async function loadMore() {
    if (!nextCursor) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setLoadError(null)
    const params = new URLSearchParams({ limit: '10', cursor: nextCursor })
    if (query.trim()) params.set('q', query.trim())
    try {
      const response = await apiRequest<{
        items: PublicBrand[]
        nextCursor: string | null
      }>(`/api/brands?${params}`, { signal: controller.signal })
      setItems((current) => [
        ...current,
        ...response.items.filter(
          (brand) => !current.some((item) => item.id === brand.id),
        ),
      ])
      setNextCursor(response.nextCursor)
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        setLoadError(
          cause instanceof ApiError
            ? cause.message
            : 'More brands could not be loaded. Try again.',
        )
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  return (
    <section aria-labelledby="brand-picker-title" className="grid gap-3">
      <div>
        <h3 id="brand-picker-title" className="text-sm font-medium">
          Brand
        </h3>
        <p className="mt-1 text-sm text-muted">
          Optional. Search active brands ten at a time.
        </p>
      </div>
      {selected && selectedId ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-brand-soft p-3">
          <div>
            <p className="font-semibold">{selected.name}</p>
            <p className="text-sm text-muted">Selected brand</p>
          </div>
          <Button
            variant="quiet"
            onClick={() => onSelect(null)}
            disabled={disabled}
          >
            Clear brand
          </Button>
        </div>
      ) : null}
      <Field label="Search brands" htmlFor="brand-search" error={issue}>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type a brand name"
          disabled={disabled}
        />
      </Field>
      {loadError ? <Notice tone="danger">{loadError}</Notice> : null}
      {loading && items.length === 0 ? (
        <output className="text-sm text-muted">Loading brands...</output>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted">
          No active brands match this search. Clear the search or leave the
          product unbranded.
        </p>
      ) : (
        <ul className="grid max-h-64 gap-2 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
          {items.map((brand) => (
            <li key={brand.id}>
              <Button
                variant={selectedId === brand.id ? 'primary' : 'quiet'}
                className="w-full justify-start"
                onClick={() => onSelect(brand)}
                disabled={disabled}
              >
                {brand.name}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {nextCursor ? (
        <div>
          <Button
            variant="secondary"
            onClick={() => void loadMore()}
            disabled={disabled || loading}
          >
            {loading ? 'Loading...' : 'Load more brands'}
          </Button>
        </div>
      ) : null}
    </section>
  )
}
