'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ApiError, apiRequest } from '@/lib/api-client'

/** Sent on window by whatever changes the cart, with the new item count. */
export const CART_CHANGED = 'ecokart:cart-changed'

export function announceCartCount(itemCount: number) {
  window.dispatchEvent(new CustomEvent(CART_CHANGED, { detail: itemCount }))
}

/**
 * The header's cart link with how many items are in it. It reads the cart
 * in the browser, so the cached public pages around it never read the
 * visitor's session or cart cookie.
 */
export function CartLink() {
  const [count, setCount] = useState<number | null>(null)
  // An administrator or an account that only sells has no cart.
  const [noCart, setNoCart] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    apiRequest<{ cart: { itemCount: number } }>('/api/cart', {
      signal: controller.signal,
    })
      .then((answer) => {
        setCount(answer.cart.itemCount)
        return undefined
      })
      .catch((cause: unknown) => {
        if (cause instanceof ApiError && cause.status === 403) setNoCart(true)
      })
    const changed = (event: Event) => {
      if (event instanceof CustomEvent && typeof event.detail === 'number') {
        setCount(event.detail)
      }
    }
    window.addEventListener(CART_CHANGED, changed)
    return () => {
      controller.abort()
      window.removeEventListener(CART_CHANGED, changed)
    }
  }, [])

  if (noCart) return null
  const label =
    count === null ? 'Cart' : `Cart, ${count} ${count === 1 ? 'item' : 'items'}`
  return (
    // An address object: the cart page is its own journey, built next.
    <Link
      href={{ pathname: '/cart' }}
      aria-label={label}
      className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-lg border bg-surface text-foreground hover:border-brand hover:text-brand-strong"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 4h2l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 8H6.2" />
        <circle cx="9.5" cy="20" r="1.2" />
        <circle cx="17.5" cy="20" r="1.2" />
      </svg>
      {count ? (
        <span
          aria-hidden="true"
          className="absolute -top-1.5 -right-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-brand px-1 text-xs font-semibold text-white"
        >
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Link>
  )
}
