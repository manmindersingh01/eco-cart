'use client'

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card, Notice } from '@/components/ui/feedback'
import { Field, Input } from '@/components/ui/form-controls'
import { ApiError, apiRequest } from '@/lib/api-client'
import type { SellerProduct } from '@/lib/product-editor'
import {
  MAX_MIN_ORDER_QUANTITY,
  parseMinOrderQuantity,
} from '@/lib/seller-products'

/**
 * The fewest units of one variant a buyer may order. It may change at any
 * status, even while the listing is on sale, like prices and stock.
 */
export function ProductMinimumQuantity({
  product,
  onProduct,
}: {
  product: SellerProduct
  onProduct: (product: SellerProduct) => void
}) {
  const [value, setValue] = useState(String(product.minOrderQuantity))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = parseMinOrderQuantity(value)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    if (parsed.value === product.minOrderQuantity) {
      setError('Change the number before saving.')
      return
    }
    setPending(true)
    setError(null)
    setSaved(false)
    try {
      const response = await apiRequest<{ product: SellerProduct }>(
        `/api/seller/products/${product.id}`,
        { method: 'PATCH', json: { minOrderQuantity: parsed.value } },
      )
      onProduct(response.product)
      setValue(String(response.product.minOrderQuantity))
      setSaved(true)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        window.location.assign(
          `/sign-in?returnTo=${encodeURIComponent(`/seller/products/${product.id}`)}&reason=session-ended`,
        )
        return
      }
      setError(
        cause instanceof ApiError
          ? [cause.message, ...cause.issues].join(' ')
          : 'The minimum could not be saved. Check your connection and try again.',
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <form onSubmit={save} noValidate autoComplete="off">
        <h2 className="text-lg font-semibold">Minimum order</h2>
        <p className="mt-1 max-w-prose text-sm text-muted">
          The fewest units of one variant a buyer may order. For example, 10
          means a buyer adds at least 10 of the size or colour they choose. It
          can change at any time.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Field
            label="Minimum order quantity"
            htmlFor="product-min-order"
            hint={`A whole number from 1 to ${MAX_MIN_ORDER_QUANTITY.toLocaleString('en-IN')}.`}
            error={error ?? undefined}
            className="w-full max-w-xs"
          >
            <Input
              value={value}
              onChange={(event) => {
                setValue(event.target.value)
                setError(null)
                setSaved(false)
              }}
              inputMode="numeric"
              maxLength={4}
              disabled={pending}
            />
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving...' : 'Save minimum'}
          </Button>
        </div>
        {saved ? (
          <Notice className="mt-4" tone="success">
            Saved. Buyers now order at least{' '}
            {product.minOrderQuantity.toLocaleString('en-IN')} of a variant.
          </Notice>
        ) : null}
      </form>
    </Card>
  )
}
