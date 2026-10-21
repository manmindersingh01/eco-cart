'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, Input, Select } from '@/components/ui/form-controls'
import { paiseToRupeeInput, parseRupeesToPaise } from '@/lib/admin-settings'
import {
  LIST_SORTS,
  listingHref,
  type ListingQuery,
  type SortOption,
} from '@/lib/storefront-display'

/**
 * Filters and sort of a storefront list, kept in the address so a reload,
 * a shared link, or Back shows the same list. Prices are typed in rupees
 * and sent as whole paise, converted without floating point.
 */
export function ListingControls({
  path,
  query,
  brands,
  sorts = LIST_SORTS,
  defaultSort = 'newest',
}: {
  path: `/categories/${string}` | '/search'
  query: ListingQuery
  brands: readonly { slug: string; name: string }[]
  sorts?: readonly SortOption[]
  defaultSort?: string
}) {
  const router = useRouter()
  const [brand, setBrand] = useState(query.brand ?? '')
  const [minPrice, setMinPrice] = useState(() =>
    paiseToRupeeInput(Number(query.minPricePaise ?? Number.NaN)),
  )
  const [maxPrice, setMaxPrice] = useState(() =>
    paiseToRupeeInput(Number(query.maxPricePaise ?? Number.NaN)),
  )
  const [includeOutOfStock, setIncludeOutOfStock] = useState(
    query.includeOutOfStock === 'true',
  )
  const [sort, setSort] = useState(query.sort ?? defaultSort)
  const [error, setError] = useState<string | null>(null)

  function paise(value: string, label: string): string | null | false {
    if (!value.trim()) return null
    const parsed = parseRupeesToPaise(value)
    if (!parsed.ok) {
      setError(`${label}: ${parsed.error}`)
      return false
    }
    return String(parsed.value)
  }

  function apply(event?: FormEvent<HTMLFormElement>, nextSort = sort) {
    event?.preventDefault()
    setError(null)
    const min = paise(minPrice, 'Lowest price')
    const max = paise(maxPrice, 'Highest price')
    if (min === false || max === false) return
    if (min !== null && max !== null && Number(min) > Number(max)) {
      setError('The lowest price must not be more than the highest price.')
      return
    }
    router.push(
      listingHref(path, query, {
        brand: brand || undefined,
        minPricePaise: min ?? undefined,
        maxPricePaise: max ?? undefined,
        includeOutOfStock: includeOutOfStock ? 'true' : undefined,
        sort: nextSort === defaultSort ? undefined : nextSort,
      }),
    )
  }

  const filtered = Boolean(
    query.brand ||
    query.minPricePaise ||
    query.maxPricePaise ||
    query.includeOutOfStock,
  )

  return (
    <form
      onSubmit={apply}
      noValidate
      className="grid gap-3 rounded-xl border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-end"
    >
      <Field label="Brand" htmlFor="listing-brand">
        <Select
          value={brand}
          onChange={(event) => setBrand(event.target.value)}
        >
          <option value="">All brands</option>
          {brands.map((option) => (
            <option key={option.slug} value={option.slug}>
              {option.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Lowest price (₹)" htmlFor="listing-min-price">
        <Input
          value={minPrice}
          onChange={(event) => setMinPrice(event.target.value)}
          inputMode="decimal"
          placeholder="0"
        />
      </Field>
      <Field label="Highest price (₹)" htmlFor="listing-max-price">
        <Input
          value={maxPrice}
          onChange={(event) => setMaxPrice(event.target.value)}
          inputMode="decimal"
          placeholder="Any"
        />
      </Field>
      <Field label="Sort by" htmlFor="listing-sort">
        <Select
          value={sort}
          onChange={(event) => {
            setSort(event.target.value)
            apply(undefined, event.target.value)
          }}
        >
          {sorts.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2 lg:col-span-4">
        <label
          htmlFor="listing-out-of-stock"
          className="flex min-h-11 items-center gap-2 text-sm"
        >
          <Checkbox
            id="listing-out-of-stock"
            checked={includeOutOfStock}
            onChange={(event) => setIncludeOutOfStock(event.target.checked)}
          />
          Show products that are out of stock
        </label>
        <div className="flex flex-wrap items-center gap-3">
          {filtered ? (
            <Link
              href={listingHref(path, query, {
                brand: undefined,
                minPricePaise: undefined,
                maxPricePaise: undefined,
                includeOutOfStock: undefined,
              })}
              className="text-sm font-semibold text-brand-strong underline-offset-4 hover:underline"
            >
              Clear filters
            </Link>
          ) : null}
          <Button type="submit">Apply filters</Button>
        </div>
      </div>
      {error ? (
        <p
          role="alert"
          className="text-sm font-medium text-danger sm:col-span-2 lg:col-span-4"
        >
          {error}
        </p>
      ) : null}
    </form>
  )
}
