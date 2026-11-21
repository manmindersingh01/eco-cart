'use client'

import type { CartView, PlacedOrder } from '@ecokart/core'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { AddressForm, AddressLines, type Address } from './address-form'
import { optionsText } from './line-thumbnail'
import { OrderTotals } from './order-totals'
import { announceCartCount } from '@/components/storefront/cart-link'
import { Button, LinkButton } from '@/components/ui/button'
import { Card, EmptyState, Notice, Skeleton } from '@/components/ui/feedback'
import { ApiError, apiRequest } from '@/lib/api-client'
import { cx } from '@/lib/classes'
import { payOnline, type PaymentOutcome } from '@/lib/razorpay-checkout'
import { formatPrice } from '@/lib/storefront-display'

type Method = 'razorpay' | 'cod'
type Problem = { message: string; issues: string[] }

export type CheckoutOptions = {
  cashOnDelivery: boolean
  online: { keyId: string } | null
}

/**
 * The cart, priced fresh by the server. A guest's cart moves into the
 * account on this read, so the header's count follows it.
 */
async function fetchCart(signal?: AbortSignal): Promise<CartView> {
  const { cart } = await apiRequest<{ cart: CartView }>('/api/cart', {
    signal,
  })
  announceCartCount(cart.itemCount)
  return cart
}

/** Where the order page takes the buyer after Razorpay's window. */
function paymentNote(outcome: PaymentOutcome): string {
  if (outcome.kind === 'checked') {
    return outcome.result.status === 'confirmed'
      ? 'confirmed'
      : outcome.result.status === 'pending'
        ? 'pending'
        : 'late'
  }
  return outcome.kind
}

/**
 * Checkout: the buyer picks where it goes and how to pay, sees the total the
 * server worked out, and places the order. The server checks the cart,
 * stock, coupon, and total again; if the total has changed since it was
 * shown, the order is refused and the new total shown instead.
 */
export function CheckoutManager({
  initialAddresses,
  options,
}: {
  initialAddresses: Address[]
  options: CheckoutOptions
}) {
  const router = useRouter()
  const [cart, setCart] = useState<CartView | null>(null)
  const [loadProblem, setLoadProblem] = useState<string | null>(null)
  const [addresses, setAddresses] = useState(initialAddresses)
  const [addressId, setAddressId] = useState<string | null>(
    () =>
      (
        initialAddresses.find((address) => address.isDefault) ??
        initialAddresses[0]
      )?.id ?? null,
  )
  const [addingAddress, setAddingAddress] = useState(
    initialAddresses.length === 0,
  )
  const [method, setMethod] = useState<Method | null>(
    options.online ? 'razorpay' : options.cashOnDelivery ? 'cod' : null,
  )
  const [placing, setPlacing] = useState(false)
  const [problem, setProblem] = useState<Problem | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetchCart(controller.signal)
      .then((loaded) => {
        setCart(loaded)
        return undefined
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setLoadProblem(
          cause instanceof ApiError
            ? cause.message
            : 'Your cart could not be loaded. Check your connection and try again.',
        )
      })
    return () => controller.abort()
  }, [])

  async function placeOrder() {
    if (!cart || !addressId || !method || placing) return
    setPlacing(true)
    setProblem(null)
    let placed: PlacedOrder
    try {
      placed = await apiRequest<PlacedOrder>('/api/checkout', {
        method: 'POST',
        json: {
          addressId,
          paymentMethod: method,
          expectedTotalPaise: cart.totalPaise,
        },
      })
    } catch (cause) {
      setProblem(
        cause instanceof ApiError
          ? { message: cause.message, issues: cause.issues }
          : {
              message:
                'Your order could not be placed. Check your connection and try again.',
              issues: [],
            },
      )
      // A changed price, stock, or coupon shows at once, with its new total.
      if (cause instanceof ApiError && cause.status === 409) {
        const fresh = await fetchCart().catch(() => null)
        if (fresh) setCart(fresh)
      }
      setPlacing(false)
      return
    }
    // The cart became the order.
    announceCartCount(0)
    const orderPath = `/account/orders/${placed.order.id}` as const
    if (!placed.payment) {
      router.replace(`${orderPath}?placed=1`)
      return
    }
    const outcome = await payOnline(placed.payment, placed.order.orderNumber)
    router.replace(`${orderPath}?payment=${paymentNote(outcome)}`)
  }

  if (loadProblem) {
    return <Notice tone="danger" title={loadProblem} />
  }
  if (!cart) {
    return (
      <div className="grid gap-4" aria-busy="true">
        <span className="sr-only">Loading checkout</span>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    )
  }
  if (!cart.lines.length) {
    return (
      <EmptyState
        title="Your cart is empty"
        description="Add something to your cart, then come back to check out."
        action={<LinkButton href="/">Start shopping</LinkButton>}
      />
    )
  }

  const noPayment = !options.online && !options.cashOnDelivery
  const ready =
    cart.canCheckOut && Boolean(addressId) && Boolean(method) && !placing
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div className="grid gap-6">
        {cart.canCheckOut ? null : (
          <Notice tone="warning" title="Your cart needs a change first">
            <p>
              Something in your cart cannot be bought as it is, for example an
              item sold out.
            </p>
            <LinkButton href="/cart" variant="secondary" className="mt-3">
              Review your cart
            </LinkButton>
          </Notice>
        )}

        <section aria-labelledby="checkout-address" className="grid gap-3">
          <h2 id="checkout-address" className="text-lg font-semibold">
            1. Delivery address
          </h2>
          {addresses.length ? (
            <fieldset className="grid gap-3 md:grid-cols-2">
              <legend className="sr-only">Choose a delivery address</legend>
              {addresses.map((address) => (
                <ChoiceCard
                  key={address.id}
                  name="address"
                  checked={addressId === address.id}
                  onChange={() => setAddressId(address.id)}
                  disabled={placing}
                >
                  <AddressLines address={address} />
                </ChoiceCard>
              ))}
            </fieldset>
          ) : null}
          {addingAddress ? (
            <Card className="grid gap-4">
              <h3 className="font-semibold">New address</h3>
              <AddressForm
                idPrefix="checkout-address"
                showDefault={addresses.length > 0}
                onSaved={(address) => {
                  setAddresses((current) => [...current, address])
                  setAddressId(address.id)
                  setAddingAddress(false)
                }}
                onCancel={
                  addresses.length ? () => setAddingAddress(false) : undefined
                }
              />
            </Card>
          ) : (
            <div>
              <Button
                variant="secondary"
                onClick={() => setAddingAddress(true)}
                disabled={placing}
              >
                Deliver to a new address
              </Button>
            </div>
          )}
        </section>

        <section aria-labelledby="checkout-payment" className="grid gap-3">
          <h2 id="checkout-payment" className="text-lg font-semibold">
            2. Payment
          </h2>
          {noPayment ? (
            <Notice tone="warning" title="No way to pay is open right now">
              Please try again later.
            </Notice>
          ) : (
            <fieldset className="grid gap-3 md:grid-cols-2">
              <legend className="sr-only">Choose how to pay</legend>
              {options.online ? (
                <ChoiceCard
                  name="payment"
                  checked={method === 'razorpay'}
                  onChange={() => setMethod('razorpay')}
                  disabled={placing}
                >
                  <span className="font-semibold">Pay online</span>
                  <span className="text-sm text-muted">
                    UPI, cards, net banking, or wallets, through Razorpay.
                  </span>
                </ChoiceCard>
              ) : null}
              {options.cashOnDelivery ? (
                <ChoiceCard
                  name="payment"
                  checked={method === 'cod'}
                  onChange={() => setMethod('cod')}
                  disabled={placing}
                >
                  <span className="font-semibold">Cash on delivery</span>
                  <span className="text-sm text-muted">
                    Pay the courier when your order arrives.
                  </span>
                </ChoiceCard>
              ) : null}
            </fieldset>
          )}
        </section>
      </div>

      <Card className="grid gap-4 lg:sticky lg:top-6">
        <h2 className="text-lg font-semibold">Your order</h2>
        <ul className="grid gap-3 text-sm">
          {cart.lines.map((line) => (
            <li key={line.variantId} className="flex justify-between gap-3">
              <span className="min-w-0">
                <span className="block break-words">{line.title}</span>
                <span className="block text-xs text-muted">
                  {[optionsText(line.options), `Qty ${line.quantity}`]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {line.problem ? (
                  <span className="block text-xs font-medium text-danger">
                    {line.problem}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0">
                {formatPrice(line.lineTotalPaise)}
              </span>
            </li>
          ))}
        </ul>
        <div className="border-t pt-4">
          <OrderTotals
            subtotalPaise={cart.subtotalPaise}
            discountPaise={cart.discountPaise}
            deliveryPaise={cart.deliveryPaise}
            totalPaise={cart.totalPaise}
            couponCode={cart.coupon?.code ?? null}
            totalLabel="To pay"
          />
        </div>
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
        <Button
          onClick={() => void placeOrder()}
          disabled={!ready}
          className="w-full"
        >
          {placing
            ? method === 'razorpay'
              ? 'Opening payment...'
              : 'Placing your order...'
            : method === 'razorpay'
              ? `Pay ${formatPrice(cart.totalPaise)}`
              : 'Place order'}
        </Button>
        {addressId ? null : (
          <p className="text-sm text-muted">
            Add a delivery address to place your order.
          </p>
        )}
      </Card>
    </div>
  )
}

/** A radio button the size of a card, for an address or a way to pay. */
function ChoiceCard({
  name,
  checked,
  onChange,
  disabled,
  children,
}: {
  name: string
  checked: boolean
  onChange: () => void
  disabled: boolean
  children: ReactNode
}) {
  return (
    <label
      className={cx(
        'flex cursor-pointer items-start gap-3 rounded-xl border bg-surface p-4 has-focus-visible:outline-2 has-focus-visible:outline-brand',
        checked ? 'border-brand ring-1 ring-brand' : 'hover:border-brand/60',
        disabled && 'cursor-not-allowed opacity-70',
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="mt-0.5 size-5 shrink-0 accent-brand"
      />
      <span className="grid min-w-0 gap-1">{children}</span>
    </label>
  )
}
