'use client'

import { useEffect, useState } from 'react'
import { Button, LinkButton } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/feedback'
import { ApiError, apiRequest } from '@/lib/api-client'
import { authClient } from '@/lib/auth-client'
import type { CurrentAccount } from '@/lib/auth-routing'
import { formatStatusLabel } from '@/lib/format'

type AccountControlsProps = {
  initialAccount?: CurrentAccount
  compact?: boolean
  /** Where the controls sit: the shop, or one of the two portals. */
  area?: 'shop' | 'seller' | 'admin'
}

/**
 * The link next to Sign out: from a portal back to the shop, and from the
 * shop to the portal the account may use, or to applying to sell.
 */
function areaLink(
  account: CurrentAccount,
  area: NonNullable<AccountControlsProps['area']>,
): {
  href: '/' | '/admin' | '/seller' | '/account/seller-application'
  label: string
} | null {
  if (area !== 'shop') return { href: '/', label: 'Back to shop' }
  if (account.roles.includes('admin'))
    return { href: '/admin', label: 'Admin portal' }
  if (account.roles.includes('seller'))
    return { href: '/seller', label: 'Seller portal' }
  if (account.roles.includes('buyer')) {
    return { href: '/account/seller-application', label: 'Sell on EcoKart' }
  }
  return null
}

export function AccountControls({
  initialAccount,
  compact = false,
  area = 'shop',
}: AccountControlsProps) {
  const [account, setAccount] = useState<CurrentAccount | null>(
    initialAccount ?? null,
  )
  const [loading, setLoading] = useState(initialAccount === undefined)
  const [unavailable, setUnavailable] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)

  useEffect(() => {
    if (initialAccount !== undefined) return undefined

    const controller = new AbortController()
    let active = true
    apiRequest<CurrentAccount>('/api/me', { signal: controller.signal })
      .then((currentAccount) => {
        if (!active) return undefined
        setAccount(currentAccount)
        setUnavailable(false)
        return undefined
      })
      .catch((error: unknown) => {
        if (!active) return undefined
        if (error instanceof DOMException && error.name === 'AbortError') {
          return undefined
        }
        if (error instanceof ApiError && error.status === 401) {
          setAccount(null)
          setUnavailable(false)
          return undefined
        }
        setUnavailable(true)
        return undefined
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [initialAccount])

  async function signOut() {
    setSigningOut(true)
    setSignOutError(null)
    try {
      const result = await authClient.signOut()
      if (result.error) {
        setSignOutError(
          result.error.message ?? 'Sign-out failed. Please try again.',
        )
        setSigningOut(false)
        return
      }
      window.location.assign('/')
    } catch {
      setSignOutError('Sign-out failed. Please try again.')
      setSigningOut(false)
    }
  }

  if (loading) {
    return <Skeleton className="h-11 w-28" />
  }

  if (!account) {
    if (unavailable) {
      return (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="text-sm text-danger">Account unavailable</span>
          <Button variant="quiet" disabled={signingOut} onClick={signOut}>
            {signingOut ? 'Signing out...' : 'Sign out'}
          </Button>
          {signOutError ? (
            <p role="alert" className="w-full text-right text-sm text-danger">
              {signOutError}
            </p>
          ) : null}
        </div>
      )
    }
    return (
      <div className="flex items-center">
        <LinkButton href="/sign-in" variant="secondary">
          Sign in
        </LinkButton>
      </div>
    )
  }

  const label =
    account.name || account.email || account.phoneNumber || 'Account'
  const link = areaLink(account, area)
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
      <div className={compact ? 'sr-only' : 'min-w-0 text-right'}>
        <p className="truncate text-sm font-medium">{label}</p>
        <p className="text-xs text-muted">{formatStatusLabel(account.role)}</p>
      </div>
      {link ? (
        <LinkButton href={link.href} variant="secondary">
          {link.label}
        </LinkButton>
      ) : null}
      <Button
        variant="quiet"
        disabled={signingOut}
        aria-label={compact ? `Sign out ${label}` : undefined}
        onClick={signOut}
      >
        {signingOut ? 'Signing out...' : 'Sign out'}
      </Button>
      {signOutError ? (
        <p role="alert" className="w-full text-right text-sm text-danger">
          {signOutError}
        </p>
      ) : null}
    </div>
  )
}
