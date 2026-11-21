'use client'

import type { CartLine, CartView } from '@ecokart/core'
import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
import { LineThumbnail, optionsText } from './line-thumbnail'
import { OrderTotals } from './order-totals'
import { QuantityStepper } from './quantity-stepper'
import { announceCartCount } from '@/components/storefront/cart-link'
import { Button, LinkButton } from '@/components/ui/button'
import { Card, EmptyState, Notice, Skeleton } from '@/components/ui/feedback'
import { Field, Input } from '@/components/ui/form-controls'
import { ApiError, apiRequest } from '@/lib/api-client'
import { cx } from '@/lib/classes'
import { discountPercent, formatPrice } from '@/lib/storefront-display'

type Problem = { message: string; issues: string[] }

const problemOf = (cause: unknown): Problem =>
  cause instanceof ApiError
    ? { message: cause.message, issues: cause.issues }
    : {
        message: 'That did not work. Check your connection and try again.',
        issues: [],
      }

/**
 * The visitor's cart, read in the browser so it works the same for a guest
 * and a signed-in buyer: the server prices it fresh every time, and a
 * guest's cart moves into their account once they sign in.
 */
export function CartManager() {
  const [cart, setCart] = useState<CartView | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'no_cart'>(
    'loading',
  )
  const [loadProblem, setLoadProblem] = useState<Problem | null>(null)
  // The variant being changed, or 'coupon'.
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [notices, setNotices] = useState<string[]>([])
  const [couponCode, setCouponCode] = useState('')

  function show(next: CartView) {
    setCart(next)
    setStatus('ready')
    announceCartCount(next.itemCount)
    if (next.notices.length) setNotices(next.notices)
  }

  useEffect(() => {
    const controller = new AbortController()
    apiRequest<{ cart: CartView }>('/api/cart', { signal: controller.signal })
      .then(({ cart: loaded }) => {
        setCart(loaded)
        setStatus('ready')
        announceCartCount(loaded.itemCount)
        if (loaded.notices.length) setNotices(loaded.notices)
        return undefined
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        if (cause instanceof ApiError && cause.status === 403) {
          setStatus('no_cart')
          return
        }
        setLoadProblem(problemOf(cause))
      })
    return () => controller.abort()
  }, [])

  async function change(
    key: string,
    request: () => Promise<{ cart: CartView }>,
  ): Promise<boolean> {
    setBusy(key)
    setProblem(null)
    setNotices([])
    try {
      show((await request()).cart)
      return true
    } catch (cause) {
      setProblem(problemOf(cause))
      return false
    } finally {
      setBusy(null)
    }
  }

  const setQuantity = (line: CartLine, quantity: number) =>
    change(line.variantId, () =>
      apiRequest(`/api/cart/items/${line.variantId}`, {
        method: 'PATCH',
        json: { quantity },
      }),
    )

  const remove = (line: CartLine) =>
    change(line.variantId, () =>
      apiRequest(`/api/cart/items/${line.variantId}`, { method: 'DELETE' }),
    )

  async function applyCoupon(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!couponCode.trim()) return
    const applied = await change('coupon', () =>
      apiRequest('/api/cart/coupon', {
        method: 'PUT',
        json: { code: couponCode },
      }),
    )
    if (applied) setCouponCode('')
  }

  const removeCoupon = () =>
    change('coupon', () => apiRequest('/api/cart/coupon', { method: 'DELETE' }))

  if (loadProblem) {
    return (
      <Notice tone="danger" title="Your cart could not be loaded">
        <p>{loadProblem.message}</p>
        <Button
          variant="secondary"
          className="mt-3"
          onClick={() => window.location.reload()}
        >
          Try again
        </Button>
      </Notice>
    )
  }
  if (status === 'no_cart') {
    return (
      <Notice tone="warning" title="This account cannot shop">
        Administrator accounts have no cart. Sign in with a buyer account to
        buy.
      </Notice>
    )
  }
  if (status === 'loading' || !cart) {
    return (
      <div className="grid gap-4" aria-busy="true">
        <span className="sr-only">Loading your cart</span>
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    )
  }

  const messages = (
    <>
      {notices.length ? (
        <Notice tone="warning" title="Your cart has changed">
          <ul className="list-disc pl-5">
            {notices.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {problem ? (
        <Notice tone="danger" title={problem.message}>
          {problem.issues.length ? (
            <ul className="list-disc pl-5">
              {problem.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </Notice>
      ) : null}
    </>
  )

  if (!cart.lines.length) {
    return (
      <div className="grid gap-4">
        {messages}
        <EmptyState
          title="Your cart is empty"
          description="Products you add to your cart are kept here, even before you sign in."
          action={<LinkButton href="/">Start shopping</LinkButton>}
        />
      </div>
    )
  }

  const blocked = cart.lines.some((line) => line.problem)
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div className="grid gap-4">
        {messages}
        <ul className="grid gap-3" aria-label="Items in your cart">
          {cart.lines.map((line) => (
            <li key={line.variantId}>
              <CartLineCard
                line={line}
                busy={busy === line.variantId}
                disabled={busy !== null}
                onQuantity={(quantity) => void setQuantity(line, quantity)}
                onRemove={() => void remove(line)}
              />
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-4 lg:sticky lg:top-6">
        <Card className="grid gap-4">
          <h2 className="text-lg font-semibold">Order summary</h2>
          <OrderTotals
            subtotalPaise={cart.subtotalPaise}
            discountPaise={cart.discountPaise}
            deliveryPaise={cart.deliveryPaise}
            totalPaise={cart.totalPaise}
            couponCode={cart.coupon?.code ?? null}
          />
          {cart.canCheckOut ? (
            <LinkButton href="/checkout" className="w-full">
              Check out
            </LinkButton>
          ) : (
            <>
              <Button disabled className="w-full">
                Check out
              </Button>
              <p className="text-sm text-muted">
                {blocked
                  ? 'Change or remove the items marked above to check out.'
                  : 'Remove the coupon or fix what it says to check out.'}
              </p>
            </>
          )}
        </Card>

        <Card className="grid gap-3">
          <h2 className="font-semibold">Coupon</h2>
          {cart.coupon ? (
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-sm font-semibold">
                  {cart.coupon.code}
                </p>
                <Button
                  variant="quiet"
                  onClick={() => void removeCoupon()}
                  disabled={busy !== null}
                >
                  {busy === 'coupon' ? 'Removing...' : 'Remove'}
                </Button>
              </div>
              {cart.coupon.description ? (
                <p className="text-sm text-muted">{cart.coupon.description}</p>
              ) : null}
              {cart.coupon.problem ? (
                <p className="text-sm font-medium text-danger">
                  {cart.coupon.problem}
                </p>
              ) : (
                <p className="text-sm font-medium text-success">
                  You save {formatPrice(cart.coupon.discountPaise)}
                </p>
              )}
            </div>
          ) : (
            <form
              onSubmit={(event) => void applyCoupon(event)}
              className="flex items-end gap-2"
            >
              <Field
                label="Coupon code"
                htmlFor="coupon-code"
                className="min-w-0 flex-1"
              >
                <Input
                  value={couponCode}
                  onChange={(event) => setCouponCode(event.target.value)}
                  autoCapitalize="characters"
                  autoComplete="off"
                  maxLength={40}
                  className="uppercase"
                />
              </Field>
              <Button
                type="submit"
                variant="secondary"
                disabled={busy !== null || !couponCode.trim()}
              >
                {busy === 'coupon' ? 'Applying...' : 'Apply'}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  )
}

function CartLineCard({
  line,
  busy,
  disabled,
  onQuantity,
  onRemove,
}: {
  line: CartLine
  busy: boolean
  disabled: boolean
  onQuantity: (quantity: number) => void
  onRemove: () => void
}) {
  const discount = discountPercent(line.unitPricePaise, line.unitMrpPaise)
  const options = optionsText(line.options)
  const belowMinimum = line.quantity < line.minQuantity
  const canBuy = line.maxQuantity >= line.minQuantity
  return (
    // Phone: the photo and the details side by side, with the quantity,
    // Remove, and the line's total in a row of their own below them.
    // Wider: the controls form a third column.
    <Card
      className={cx(
        'grid grid-cols-[auto_minmax(0,1fr)] gap-3 transition-opacity sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-4',
        busy && 'opacity-60',
      )}
      aria-busy={busy || undefined}
    >
      <LineThumbnail url={line.imageUrl} />
      <div className="grid min-w-0 content-start gap-1">
        <h3 className="font-semibold">
          <Link
            href={`/products/${line.productSlug}`}
            className="break-words hover:text-brand-strong hover:underline"
          >
            {line.title}
          </Link>
        </h3>
        {options ? <p className="text-sm text-muted">{options}</p> : null}
        <p className="text-xs text-muted">Sold by {line.sellerName}</p>
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-medium">
            {formatPrice(line.unitPricePaise)} each
          </span>
          {discount ? (
            <s className="text-xs text-muted">
              <span className="sr-only">MRP </span>
              {formatPrice(line.unitMrpPaise)}
            </s>
          ) : null}
        </p>
        {line.minQuantity > 1 ? (
          <p className="text-xs text-muted">
            Minimum {line.minQuantity} per order
          </p>
        ) : null}
        {line.problem ? (
          <p className="text-sm font-medium text-danger">{line.problem}</p>
        ) : null}
      </div>
      <div className="col-span-2 flex flex-wrap items-center justify-between gap-3 sm:col-span-1 sm:flex-col sm:items-end sm:justify-start">
        <div className="flex items-center gap-1">
          {canBuy ? (
            <QuantityStepper
              id={`quantity-${line.variantId}`}
              label={`Quantity of ${line.title}`}
              value={line.quantity}
              min={line.minQuantity}
              max={line.maxQuantity}
              disabled={disabled}
              onChange={onQuantity}
            />
          ) : null}
          <Button
            variant="quiet"
            onClick={onRemove}
            disabled={disabled}
            aria-label={`Remove ${line.title}`}
          >
            Remove
          </Button>
        </div>
        <p className="font-semibold sm:order-first">
          <span className="sr-only">Line total </span>
          {formatPrice(line.lineTotalPaise)}
        </p>
        {belowMinimum && canBuy ? (
          <Button
            variant="secondary"
            onClick={() => onQuantity(line.minQuantity)}
            disabled={disabled}
            className="w-full sm:w-auto"
          >
            Change to {line.minQuantity}
          </Button>
        ) : null}
      </div>
    </Card>
  )
}
