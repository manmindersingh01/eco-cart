'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { PaginationButton } from '@/components/ui/button'
import { productListHref, type ProductStatus } from '@/lib/seller-products'

function storageKey(status?: ProductStatus) {
  return `ecokart:product-list-history:${status ?? 'all'}`
}

function readHistory(status?: ProductStatus): Array<string | null> {
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
  status: ProductStatus | undefined,
  history: Array<string | null>,
) {
  try {
    sessionStorage.setItem(storageKey(status), JSON.stringify(history))
  } catch {
    // Browser history still provides recovery if session storage is unavailable.
  }
}

export function ProductPagination({
  status,
  cursor,
  nextCursor,
}: {
  status?: ProductStatus
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
    startTransition(() => router.push(productListHref(status, nextCursor)))
  }

  function previous() {
    const history = readHistory(status)
    const previousCursor = history.pop()
    writeHistory(status, history)
    setHistoryLength(history.length)
    startTransition(() =>
      router.push(productListHref(status, previousCursor ?? undefined)),
    )
  }

  if (!cursor && !nextCursor) return null

  return (
    <nav
      aria-label="Product pages"
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <PaginationButton
        onClick={previous}
        disabled={isPending || (!cursor && historyLength === 0)}
      >
        Previous page
      </PaginationButton>
      <span className="text-sm text-muted">
        {cursor ? 'Showing older products' : 'Showing newest products'}
      </span>
      <PaginationButton onClick={next} disabled={isPending || !nextCursor}>
        Next page
      </PaginationButton>
    </nav>
  )
}
