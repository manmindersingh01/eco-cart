'use client'

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState, Notice, StatusBadge } from '@/components/ui/feedback'
import { Field, Input } from '@/components/ui/form-controls'
import { ApiError, apiRequest } from '@/lib/api-client'
import type { PublicBrandPage } from '@/lib/public-catalogue'
import { brandListUrl, mergeBrands } from '@/lib/public-home'

function loadBrandPage(searchTerm: string, cursor?: string) {
  return apiRequest<PublicBrandPage>(brandListUrl(searchTerm, cursor))
}

export function BrandDiscovery({
  initialPage,
}: {
  initialPage: PublicBrandPage
}) {
  const [query, setQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [brands, setBrands] = useState(initialPage.items)
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const normalised = query.trim()
      const page = await loadBrandPage(normalised)
      setActiveQuery(normalised)
      setBrands(page.items)
      setNextCursor(page.nextCursor)
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'Brands could not be loaded. Check your connection and try again.',
      )
    } finally {
      setPending(false)
    }
  }

  async function loadMore() {
    if (!nextCursor) return
    setPending(true)
    setError(null)
    try {
      const page = await loadBrandPage(activeQuery, nextCursor)
      setBrands((current) => mergeBrands(current, page.items))
      setNextCursor(page.nextCursor)
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'More brands could not be loaded. Check your connection and try again.',
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid gap-5" aria-busy={pending}>
      <form
        onSubmit={submitSearch}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <Field
          label="Find a brand"
          htmlFor="public-brand-search"
          hint="Searches active EcoKart brands only."
          className="w-full max-w-xl"
        >
          <Input
            id="public-brand-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={80}
            disabled={pending}
          />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? 'Loading...' : 'Search brands'}
        </Button>
      </form>

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {activeQuery ? (
        <output className="text-sm text-muted">
          Showing active brands matching “{activeQuery}”.
        </output>
      ) : null}

      {brands.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {brands.map((brand) => (
            <li key={brand.id}>
              <div className="flex min-h-20 items-center justify-center rounded-xl border bg-surface p-4 text-center font-semibold shadow-[var(--shadow-card)]">
                {brand.name}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title={
            activeQuery ? 'No matching brands' : 'Brands are being prepared'
          }
          description={
            activeQuery
              ? 'Try a shorter or different brand name.'
              : 'Active brands will appear here after the catalogue team adds them.'
          }
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        {nextCursor ? (
          <Button
            variant="secondary"
            onClick={() => void loadMore()}
            disabled={pending}
          >
            {pending ? 'Loading...' : 'Load more brands'}
          </Button>
        ) : null}
        <StatusBadge>{brands.length.toLocaleString('en-IN')} shown</StatusBadge>
      </div>
    </div>
  )
}
