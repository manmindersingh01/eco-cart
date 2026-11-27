'use client'

import type { NaturalSearchResult, Page, ProductCard } from '@ecokart/core'
import { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, LinkButton } from '@/components/ui/button'
import { Card, EmptyState, Notice } from '@/components/ui/feedback'
import {
  Checkbox,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/ui/form-controls'
import { ProductGrid } from './product-card'
import { ShoppingAssistant } from './shopping-assistant'
import { apiRequest, ApiError } from '@/lib/api-client'
import { paiseToRupeeInput, parseRupeesToPaise } from '@/lib/admin-settings'
import {
  checkSearchPhoto,
  discoveryProblem,
  discoveryRequest,
  naturalHref,
  searchPhotoTypes,
  uploadSearchPhoto,
} from '@/lib/discovery-search'
import { formatInr } from '@/lib/format'
import { useClientReady } from '@/lib/use-client-ready'

type Result = Page<ProductCard> &
  Partial<Pick<NaturalSearchResult, 'match' | 'understood'>>
export function DiscoverySearch({
  mode,
  initial,
  brands,
}: {
  mode: 'natural' | 'photo'
  initial: Record<string, string | undefined>
  brands: readonly { slug: string; name: string }[]
}) {
  const id = useId()
  const router = useRouter()
  const ready = useClientReady()
  const uploadController = useRef<AbortController | null>(null)
  const [words, setWords] = useState(initial.q ?? '')
  const [brand, setBrand] = useState(initial.brand ?? '')
  const [minimum, setMinimum] = useState(
    paiseToRupeeInput(Number(initial.minPricePaise ?? Number.NaN)),
  )
  const [maximum, setMaximum] = useState(
    paiseToRupeeInput(Number(initial.maxPricePaise ?? Number.NaN)),
  )
  const [outOfStock, setOutOfStock] = useState(
    initial.includeOutOfStock === 'true',
  )
  const [file, setFile] = useState<File | null>(null)
  const [photoKey, setPhotoKey] = useState<string>()
  const [photoCursor, setPhotoCursor] = useState<string>()
  const [photoFilters, setPhotoFilters] = useState(initial)
  const [uploading, setUploading] = useState(false)
  const [formProblem, setFormProblem] = useState('')
  const [response, setResponse] = useState<{
    key: string
    result?: Result
    problem?: string
  }>()
  const [retry, setRetry] = useState(0)
  const request =
    mode === 'natural'
      ? initial.q
        ? discoveryRequest(mode, initial)
        : null
      : photoKey
        ? discoveryRequest(mode, {
            ...photoFilters,
            photo: photoKey,
            cursor: photoCursor,
          })
        : null
  const requestKey = request ? `${retry}:${request}` : null
  const current = response?.key === requestKey ? response : undefined
  const result = current?.result ?? null
  const problem = current?.problem ?? ''
  const loading = Boolean(request && !current)
  useEffect(() => () => uploadController.current?.abort(), [])
  useEffect(() => {
    if (!request || !requestKey) return undefined
    const controller = new AbortController()
    void apiRequest<Result>(request, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      cache: 'no-store',
    })
      .then((answer) =>
        !controller.signal.aborted
          ? setResponse({ key: requestKey, result: answer })
          : undefined,
      )
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setResponse({ key: requestKey, problem: discoveryProblem(cause) })
      })
    return () => controller.abort()
  }, [request, requestKey])
  const disabled = !ready || uploading || loading
  const cursor = mode === 'natural' ? initial.cursor : photoCursor
  return (
    <div className="grid min-w-0 gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">
        {mode === 'natural' ? 'Natural language search' : 'Search by photo'}
      </h1>
      <p className="text-muted">
        {mode === 'natural'
          ? 'Describe what you need, for example a steel bottle under 500 rupees. If search by meaning cannot help, we show keyword matches.'
          : 'Choose a JPEG, PNG or WebP photo of up to 5 MB. It uploads directly to private storage and is used for this search. The upload is removed after a day.'}
      </p>
      <Card>
        <form
          aria-label={
            mode === 'natural' ? 'Natural language search' : 'Photo search'
          }
          className="grid gap-4"
          onSubmit={async (event) => {
            event.preventDefault()
            if (disabled || uploadController.current) return
            setFormProblem('')
            const filters: Record<string, string | undefined> = {
              ...initial,
              brand: brand || undefined,
              includeOutOfStock: outOfStock ? 'true' : undefined,
            }
            for (const [key, text, label] of [
              ['minPricePaise', minimum, 'Lowest price'],
              ['maxPricePaise', maximum, 'Highest price'],
            ]) {
              if (!text?.trim()) {
                filters[key!] = undefined
                continue
              }
              const parsed = parseRupeesToPaise(text)
              if (!parsed.ok) {
                setFormProblem(`${label}: ${parsed.error}`)
                return
              }
              filters[key!] = String(parsed.value)
            }
            if (
              filters.minPricePaise &&
              filters.maxPricePaise &&
              Number(filters.minPricePaise) > Number(filters.maxPricePaise)
            ) {
              setFormProblem(
                'The lowest price must not be more than the highest price.',
              )
              return
            }
            delete filters.cursor
            if (mode === 'natural') {
              if (!words.trim()) {
                setFormProblem('Describe what you need first.')
                return
              }
              const href = naturalHref(filters, { q: words.trim() })
              const currentParams = new URLSearchParams(window.location.search)
              const next = new URL(href, window.location.origin).searchParams
              currentParams.sort()
              next.sort()
              if (currentParams.toString() === next.toString())
                setRetry((old) => old + 1)
              else router.push(href)
              return
            }
            if (photoKey) {
              setPhotoFilters(filters)
              setPhotoCursor(undefined)
              setRetry((old) => old + 1)
              return
            }
            if (!file) {
              setFormProblem('Choose a photo first.')
              return
            }
            const controller = new AbortController()
            uploadController.current = controller
            setUploading(true)
            setResponse(undefined)
            try {
              const key = await uploadSearchPhoto(
                file,
                AbortSignal.any([
                  controller.signal,
                  AbortSignal.timeout(30000),
                ]),
              )
              if (!controller.signal.aborted) {
                setPhotoFilters(filters)
                setPhotoCursor(undefined)
                setPhotoKey(key)
              }
            } catch (cause) {
              if (!controller.signal.aborted)
                setFormProblem(
                  cause instanceof ApiError
                    ? discoveryProblem(cause)
                    : 'The photo upload could not finish. Choose the photo again and try again.',
                )
            } finally {
              if (uploadController.current === controller) {
                setUploading(false)
                uploadController.current = null
              }
            }
          }}
        >
          {formProblem ? (
            <Notice tone="danger" title="Check the search details">
              {formProblem}
            </Notice>
          ) : null}
          {mode === 'natural' ? (
            <Field
              label="Describe what you need"
              htmlFor={`${id}-query`}
              required
            >
              <Textarea
                value={words}
                required
                maxLength={200}
                disabled={disabled}
                onChange={(event) => setWords(event.target.value)}
              />
            </Field>
          ) : (
            <Field
              label="Search photo"
              htmlFor={`${id}-photo`}
              hint="The original photo and its private storage address are not displayed."
            >
              <Input
                type="file"
                accept={searchPhotoTypes.join(',')}
                disabled={disabled}
                onChange={(event) => {
                  const selected = event.target.files?.[0]
                  setPhotoKey(undefined)
                  setPhotoCursor(undefined)
                  setResponse(undefined)
                  setFile(null)
                  setFormProblem('')
                  if (!selected) return
                  const error = checkSearchPhoto(selected)
                  if (error) {
                    setFormProblem(error)
                    event.target.value = ''
                    return
                  }
                  setFile(selected)
                }}
              />
            </Field>
          )}
          <div className="grid min-w-0 gap-4 sm:grid-cols-3">
            <Field label="Brand" htmlFor={`${id}-brand`}>
              <Select
                value={brand}
                disabled={disabled}
                onChange={(event) => setBrand(event.target.value)}
              >
                <option value="">All brands</option>
                {brands.map((option) => (
                  <option value={option.slug} key={option.slug}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Lowest price (₹)" htmlFor={`${id}-minimum`}>
              <Input
                inputMode="decimal"
                maxLength={20}
                value={minimum}
                disabled={disabled}
                onChange={(event) => setMinimum(event.target.value)}
              />
            </Field>
            <Field label="Highest price (₹)" htmlFor={`${id}-maximum`}>
              <Input
                inputMode="decimal"
                maxLength={20}
                value={maximum}
                disabled={disabled}
                onChange={(event) => setMaximum(event.target.value)}
              />
            </Field>
          </div>
          <label
            htmlFor={`${id}-stock`}
            className="flex min-h-11 items-center gap-3 text-sm"
          >
            <Checkbox
              id={`${id}-stock`}
              checked={outOfStock}
              disabled={disabled}
              onChange={(event) => setOutOfStock(event.target.checked)}
            />
            Include out-of-stock products
          </label>
          <p className="text-sm text-muted">
            Results are ordered by best match.{' '}
            {mode === 'natural'
              ? 'Chosen filters take priority over the description. All brands lets the description choose a brand.'
              : 'Use the filters to narrow the results.'}
          </p>
          <div>
            <Button type="submit" disabled={disabled}>
              {uploading
                ? 'Uploading photo...'
                : loading
                  ? 'Searching...'
                  : photoKey
                    ? 'Apply filters'
                    : 'Search products'}
            </Button>
          </div>
        </form>
      </Card>
      <section
        aria-label="Search results"
        aria-busy={loading || uploading}
        className="grid min-w-0 gap-4"
      >
        <h2 className="text-xl font-semibold">Results</h2>
        {loading || uploading ? (
          <output>
            {uploading ? 'Uploading photo...' : 'Searching products...'}
          </output>
        ) : null}
        {problem ? (
          <Notice tone="warning" title="Search could not finish">
            <p>{problem}</p>
            <Button
              variant="secondary"
              className="mt-3"
              onClick={() => setRetry((old) => old + 1)}
            >
              Try again
            </Button>
          </Notice>
        ) : null}
        {result?.understood ? (
          <Notice title="What we understood">
            <p className="break-words">{result.understood.query}</p>
            <ul className="mt-2 list-disc pl-5">
              {result.understood.category ? (
                <li>Category: {result.understood.category.name}</li>
              ) : null}
              {result.understood.brand ? (
                <li>Brand: {result.understood.brand.name}</li>
              ) : null}
              {result.understood.minPricePaise !== null ? (
                <li>From {formatInr(result.understood.minPricePaise)}</li>
              ) : null}
              {result.understood.maxPricePaise !== null ? (
                <li>Up to {formatInr(result.understood.maxPricePaise)}</li>
              ) : null}
            </ul>
          </Notice>
        ) : null}
        {result && mode === 'natural' && result.match !== 'meaning' ? (
          <Notice title="Showing keyword matches">
            Search by meaning could not provide these results.{' '}
            {result.match === 'similar'
              ? 'These products match similar words.'
              : 'These products match the search words.'}
          </Notice>
        ) : null}
        {result ? (
          result.items.length ? (
            <ProductGrid products={result.items} />
          ) : (
            <EmptyState
              title={cursor ? 'No more results' : 'No matching products'}
              description="Try different words, another photo or fewer filters."
            />
          )
        ) : !loading && !uploading && !problem ? (
          <p className="text-muted">
            {mode === 'natural'
              ? 'Enter a description to search.'
              : 'Choose a photo to search.'}
          </p>
        ) : null}
        {result && (cursor || result.nextCursor) ? (
          <nav
            aria-label="More search results"
            className="flex flex-wrap gap-3"
          >
            {cursor ? (
              mode === 'natural' ? (
                <LinkButton variant="secondary" href={naturalHref(initial, {})}>
                  Back to the first page
                </LinkButton>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => setPhotoCursor(undefined)}
                >
                  Back to the first page
                </Button>
              )
            ) : null}
            {result.nextCursor ? (
              mode === 'natural' ? (
                <LinkButton
                  href={naturalHref(initial, { cursor: result.nextCursor })}
                >
                  Next page
                </LinkButton>
              ) : (
                <Button
                  onClick={() => setPhotoCursor(result.nextCursor ?? undefined)}
                >
                  Next page
                </Button>
              )
            ) : null}
          </nav>
        ) : null}
      </section>
      <ShoppingAssistant
        key={
          result?.items
            .map((item) => item.id)
            .slice(0, 5)
            .join(',') ?? 'empty'
        }
        productIds={result?.items.map((item) => item.id) ?? []}
      />
    </div>
  )
}
