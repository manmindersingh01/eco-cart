'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { announceCartCount } from './cart-link'
import { Button, IconButton } from '@/components/ui/button'
import { Notice } from '@/components/ui/feedback'
import { ApiError, apiRequest } from '@/lib/api-client'
import { cx } from '@/lib/classes'
import { discountPercent, formatPrice } from '@/lib/storefront-display'

type Variant = {
  id: string
  options: Record<string, string>
  pricePaise: number
  mrpPaise: number
  inStock: boolean
}

type Outcome =
  | { kind: 'added'; quantity: number; itemCount: number }
  | { kind: 'error'; message: string; issues: string[] }

/** The values of one option, in the seller's variant order. */
const valuesOf = (variants: readonly Variant[], name: string): string[] => [
  ...new Set(
    variants
      .map((variant) => variant.options[name])
      .filter((value) => value !== undefined),
  ),
]

function firstChoice(variants: readonly Variant[]): Record<string, string> {
  const variant = variants.find((item) => item.inStock) ?? variants[0]
  return variant ? { ...variant.options } : {}
}

/**
 * Choosing a variant and adding it to the cart, which works without signing
 * in: the cart is kept for the visitor and moves into their account when
 * they sign in. The quantity starts at the product's minimum and cannot go
 * below it.
 */
export function ProductPurchase({
  optionNames,
  variants,
  minOrderQuantity,
  maxQuantity,
}: {
  optionNames: readonly string[]
  variants: readonly Variant[]
  minOrderQuantity: number
  maxQuantity: number
}) {
  const [choice, setChoice] = useState(() => firstChoice(variants))
  const [quantity, setQuantity] = useState(String(minOrderQuantity))
  const [pending, setPending] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const variant = useMemo(
    () =>
      variants.find((item) =>
        optionNames.every((name) => item.options[name] === choice[name]),
      ) ?? null,
    [choice, optionNames, variants],
  )

  /** Whether choosing `value` for `name` keeps a variant in stock. */
  function available(name: string, value: string): boolean {
    return variants.some(
      (item) =>
        item.inStock &&
        item.options[name] === value &&
        optionNames.every(
          (other) => other === name || item.options[other] === choice[other],
        ),
    )
  }

  const wanted = /^\d+$/.test(quantity) ? Number(quantity) : Number.NaN
  const quantityProblem = Number.isNaN(wanted)
    ? 'Enter a whole number.'
    : wanted < minOrderQuantity
      ? `The minimum for this product is ${minOrderQuantity}.`
      : wanted > maxQuantity
        ? `You can add at most ${maxQuantity.toLocaleString('en-IN')} at a time.`
        : null

  async function addToCart() {
    if (!variant || quantityProblem) return
    setPending(true)
    setOutcome(null)
    try {
      const answer = await apiRequest<{ cart: { itemCount: number } }>(
        '/api/cart/items',
        { method: 'POST', json: { variantId: variant.id, quantity: wanted } },
      )
      announceCartCount(answer.cart.itemCount)
      setOutcome({
        kind: 'added',
        quantity: wanted,
        itemCount: answer.cart.itemCount,
      })
    } catch (cause) {
      setOutcome({
        kind: 'error',
        message:
          cause instanceof ApiError
            ? cause.message
            : 'This could not be added. Check your connection and try again.',
        issues: cause instanceof ApiError ? cause.issues : [],
      })
    } finally {
      setPending(false)
    }
  }

  const discount = variant
    ? discountPercent(variant.pricePaise, variant.mrpPaise)
    : null

  return (
    <div className="grid gap-5">
      <div>
        {variant ? (
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-3xl font-semibold">
              {formatPrice(variant.pricePaise)}
            </span>
            {discount ? (
              <>
                <span className="text-muted">
                  MRP <s>{formatPrice(variant.mrpPaise)}</s>
                </span>
                <span className="font-semibold text-success">
                  {discount}% off
                </span>
              </>
            ) : null}
          </p>
        ) : (
          <p className="text-lg font-semibold">
            This combination is not available
          </p>
        )}
        <p className="mt-1 text-sm text-muted">Price includes GST.</p>
      </div>

      {optionNames.map((name) => (
        <fieldset key={name}>
          <legend className="text-sm font-semibold">
            {name}:{' '}
            <span className="font-normal text-muted">
              {choice[name] ?? 'Choose'}
            </span>
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {valuesOf(variants, name).map((value) => {
              const selected = choice[name] === value
              const inStock = available(name, value)
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setChoice((current) => ({ ...current, [name]: value }))
                    setOutcome(null)
                  }}
                  className={cx(
                    'min-h-11 rounded-lg border px-4 text-sm font-medium',
                    selected
                      ? 'border-brand bg-brand-soft text-brand-strong'
                      : 'bg-surface hover:border-brand',
                    inStock ? null : 'text-muted line-through',
                  )}
                >
                  {value}
                  {inStock ? null : (
                    <span className="sr-only"> (out of stock)</span>
                  )}
                </button>
              )
            })}
          </div>
        </fieldset>
      ))}

      {variant ? (
        <p
          className={cx(
            'text-sm font-semibold',
            variant.inStock ? 'text-success' : 'text-danger',
          )}
        >
          {variant.inStock ? 'In stock' : 'Out of stock'}
        </p>
      ) : null}

      <div className="grid gap-2">
        <label htmlFor="purchase-quantity" className="text-sm font-semibold">
          Quantity
          {minOrderQuantity > 1 ? (
            <span className="font-normal text-muted">
              {' '}
              (minimum {minOrderQuantity})
            </span>
          ) : null}
        </label>
        <div className="flex items-center gap-2">
          <IconButton
            variant="secondary"
            aria-label="One fewer"
            disabled={pending || !(wanted > minOrderQuantity)}
            onClick={() =>
              setQuantity(String(Math.max(minOrderQuantity, wanted - 1)))
            }
          >
            −
          </IconButton>
          <input
            id="purchase-quantity"
            inputMode="numeric"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value.trim())}
            onBlur={() => {
              // Below the minimum becomes the minimum, as the buyer meant.
              if (!Number.isNaN(wanted) && wanted < minOrderQuantity) {
                setQuantity(String(minOrderQuantity))
              }
            }}
            aria-invalid={quantityProblem ? true : undefined}
            aria-describedby={
              quantityProblem ? 'purchase-quantity-error' : undefined
            }
            className="min-h-11 w-20 rounded-lg border bg-surface px-3 py-2 text-center"
          />
          <IconButton
            variant="secondary"
            aria-label="One more"
            disabled={pending || !(wanted < maxQuantity)}
            onClick={() =>
              setQuantity(
                String(Number.isNaN(wanted) ? minOrderQuantity : wanted + 1),
              )
            }
          >
            +
          </IconButton>
        </div>
        {quantityProblem ? (
          <p
            id="purchase-quantity-error"
            className="text-sm font-medium text-danger"
          >
            {quantityProblem}
          </p>
        ) : null}
      </div>

      <Button
        onClick={() => void addToCart()}
        disabled={
          pending || !variant || !variant.inStock || Boolean(quantityProblem)
        }
        className="w-full"
      >
        {pending ? 'Adding...' : 'Add to cart'}
      </Button>

      {outcome?.kind === 'added' ? (
        <Notice tone="success" title="Added to your cart">
          <p>
            {outcome.quantity} added. Your cart now has {outcome.itemCount}{' '}
            {outcome.itemCount === 1 ? 'item' : 'items'}.
          </p>
          <Link
            href={{ pathname: '/cart' }}
            className="mt-2 inline-block font-semibold underline underline-offset-4"
          >
            View cart
          </Link>
        </Notice>
      ) : null}
      {outcome?.kind === 'error' ? (
        <Notice tone="danger" title={outcome.message}>
          {outcome.issues.length ? (
            <ul className="list-disc pl-5">
              {outcome.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </Notice>
      ) : null}
    </div>
  )
}
