'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { PaginationButton } from '@/components/ui/button'
import { sellerListHref, type SellerStatus } from '@/lib/admin-sellers'

function storageKey(status?: SellerStatus) {
  return `ecokart:seller-list-history:${status ?? 'all'}`
}

function readHistory(status?: SellerStatus): Array<string | null> {
  if (typeof window === 'undefined') return []
  try {
    const stored = sessionStorage.getItem(storageKey(status))
    const parsed: unknown = stored ? JSON.parse(stored) : []
    return Array.isArray(parsed) &&
      parsed.every((item) => item === null || typeof item === 'string')
      ? parsed
      : []
  } catch {
    return []
  }
}

function writeHistory(
  status: SellerStatus | undefined,
  history: Array<string | null>,
) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(storageKey(status), JSON.stringify(history))
  } catch {
    // Browser history still provides recovery when session storage is unavailable.
  }
}

export function SellerPagination({
  status,
  cursor,
  nextCursor,
}: {
  status?: SellerStatus
  cursor?: string
  nextCursor: string | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [historyLength, setHistoryLength] = useState(
    () => readHistory(status).length,
  )

  function next() {
    if (!nextCursor) return
    const history = readHistory(status)
    const current = cursor ?? null
    if (history.at(-1) !== current) history.push(current)
    writeHistory(status, history)
    setHistoryLength(history.length)
    startTransition(() => router.push(sellerListHref(status, nextCursor)))
  }

  function back() {
    const history = readHistory(status)
    const previousCursor = history.pop()
    writeHistory(status, history)
    setHistoryLength(history.length)
    startTransition(() =>
      router.push(sellerListHref(status, previousCursor ?? undefined)),
    )
  }

  if (!cursor && !nextCursor) return null

  return (
    <nav
      aria-label="Seller pages"
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <PaginationButton
        onClick={back}
        disabled={isPending || (!cursor && historyLength === 0)}
      >
        Previous page
      </PaginationButton>
      <span className="text-sm text-muted">
        {cursor ? 'Showing a later page' : 'Showing the newest sellers'}
      </span>
      <PaginationButton onClick={next} disabled={isPending || !nextCursor}>
        Next page
      </PaginationButton>
    </nav>
  )
}
