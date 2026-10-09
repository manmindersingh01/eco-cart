'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button, PaginationButton } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import {
  DataCard,
  DataTable,
  ResponsiveDataList,
} from '@/components/ui/data-display'
import { Card, EmptyState, Notice, StatusBadge } from '@/components/ui/feedback'
import { Checkbox, Field, Input } from '@/components/ui/form-controls'
import { issuesFor } from '@/lib/admin-settings'
import {
  brandApiPath,
  brandListHref,
  replaceAbortController,
  serialiseBrand,
  type Brand,
  type BrandFormValues,
} from '@/lib/admin-catalogue'
import { ApiError, apiRequest } from '@/lib/api-client'
import { formatIndianDate } from '@/lib/format'

type BrandPage = { items: Brand[]; nextCursor: string | null }
type Feedback = {
  error: string | null
  issues: string[]
  success: string | null
  conflict: boolean
}

const idleFeedback: Feedback = {
  error: null,
  issues: [],
  success: null,
  conflict: false,
}

const emptyBrand: BrandFormValues = { name: '', slug: '', isActive: true }

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function updateBrandAddress(query: string, cursor?: string) {
  window.history.replaceState(null, '', brandListHref(query, cursor))
}

export function BrandManager({
  initialPage,
  initialQuery,
  initialCursor,
  initialError,
}: {
  initialPage: BrandPage
  initialQuery: string
  initialCursor?: string
  initialError?: string
}) {
  const [page, setPage] = useState(initialPage)
  const [search, setSearch] = useState(initialQuery)
  const [query, setQuery] = useState(initialQuery)
  const [cursor, setCursor] = useState(initialCursor)
  const [history, setHistory] = useState<Array<string | undefined>>([])
  const [pending, setPending] = useState(false)
  const [searching, setSearching] = useState(false)
  const [createValues, setCreateValues] = useState(emptyBrand)
  const [editing, setEditing] = useState<Brand | null>(null)
  const [editValues, setEditValues] = useState(emptyBrand)
  const [feedback, setFeedback] = useState<Feedback>({
    ...idleFeedback,
    error: initialError ?? null,
  })
  const searchController = useRef<AbortController>(undefined)

  function handleError(cause: unknown) {
    if (isAbort(cause)) return
    if (cause instanceof ApiError) {
      if (cause.status === 401) {
        window.location.assign(
          '/sign-in?returnTo=%2Fadmin%2Fbrands&reason=session-ended',
        )
        return
      }
      setFeedback({
        error: cause.message,
        issues: cause.issues,
        success: null,
        conflict: cause.status === 409,
      })
      return
    }
    setFeedback({
      ...idleFeedback,
      error: 'The brand request failed. Check your connection and try again.',
    })
  }

  async function requestPage(
    nextQuery: string,
    nextCursor?: string,
    signal?: AbortSignal,
  ) {
    return apiRequest<BrandPage>(brandApiPath(nextQuery, nextCursor), {
      signal,
    })
  }

  useEffect(() => {
    const nextQuery = search.trim()
    if (nextQuery === query) return undefined
    const timer = window.setTimeout(() => {
      const controller = replaceAbortController(searchController.current)
      searchController.current = controller
      setSearching(true)
      setFeedback(idleFeedback)
      void (async () => {
        try {
          const result = await apiRequest<BrandPage>(brandApiPath(nextQuery), {
            signal: controller.signal,
          })
          if (controller.signal.aborted) return
          setPage(result)
          setQuery(nextQuery)
          setCursor(undefined)
          setHistory([])
          updateBrandAddress(nextQuery)
        } catch (cause) {
          if (!isAbort(cause)) {
            if (cause instanceof ApiError) {
              if (cause.status === 401) {
                window.location.assign(
                  '/sign-in?returnTo=%2Fadmin%2Fbrands&reason=session-ended',
                )
                return
              }
              setFeedback({
                error: cause.message,
                issues: cause.issues,
                success: null,
                conflict: cause.status === 409,
              })
            } else {
              setFeedback({
                ...idleFeedback,
                error:
                  'The brand search failed. Check your connection and try again.',
              })
            }
          }
        } finally {
          if (!controller.signal.aborted) setSearching(false)
        }
      })()
    }, 300)
    return () => {
      window.clearTimeout(timer)
      searchController.current?.abort()
    }
  }, [search, query])

  async function loadPage(nextCursor: string | undefined, goingBack = false) {
    setPending(true)
    setFeedback(idleFeedback)
    try {
      const result = await requestPage(query, nextCursor)
      if (!goingBack) setHistory((current) => [...current, cursor])
      setPage(result)
      setCursor(nextCursor)
      updateBrandAddress(query, nextCursor)
    } catch (cause) {
      handleError(cause)
    } finally {
      setPending(false)
    }
  }

  async function previousPage() {
    const previous = history.at(-1)
    setHistory((current) => current.slice(0, -1))
    await loadPage(previous, true)
  }

  async function reloadPage(success?: string) {
    const result = await requestPage(query, cursor)
    setPage(result)
    if (success) setFeedback({ ...idleFeedback, success })
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setFeedback(idleFeedback)
    try {
      await apiRequest('/api/admin/brands', {
        method: 'POST',
        json: serialiseBrand(createValues, 'create'),
      })
      setCreateValues(emptyBrand)
      setCursor(undefined)
      setHistory([])
      updateBrandAddress(query)
      const result = await requestPage(query)
      setPage(result)
      setFeedback({ ...idleFeedback, success: 'Brand created.' })
    } catch (cause) {
      handleError(cause)
    } finally {
      setPending(false)
    }
  }

  function openEdit(brand: Brand) {
    setEditing(brand)
    setEditValues({
      name: brand.name,
      slug: brand.slug,
      isActive: brand.isActive,
    })
    setFeedback(idleFeedback)
    document.getElementById('brand-editor')?.scrollIntoView({ block: 'start' })
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing) return
    if (
      editValues.slug !== editing.slug &&
      !window.confirm(
        "Changing this slug changes the brand's future public URL. Continue?",
      )
    ) {
      return
    }
    setPending(true)
    setFeedback(idleFeedback)
    try {
      await apiRequest(`/api/admin/brands/${editing.id}`, {
        method: 'PATCH',
        json: serialiseBrand(editValues, 'edit'),
      })
      setEditing(null)
      await reloadPage('Brand updated.')
    } catch (cause) {
      handleError(cause)
    } finally {
      setPending(false)
    }
  }

  async function remove(brand: Brand) {
    setPending(true)
    setFeedback(idleFeedback)
    try {
      await apiRequest<void>(`/api/admin/brands/${brand.id}`, {
        method: 'DELETE',
      })
      if (editing?.id === brand.id) setEditing(null)
      await reloadPage(`${brand.name} was deleted.`)
    } catch (cause) {
      handleError(cause)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid gap-7">
      <Card>
        <Field
          label="Search brands"
          htmlFor="brand-search"
          hint="Search by any part of the brand name. Results update after a short pause."
        >
          <Input
            type="search"
            value={search}
            onChange={(event) => {
              const next = event.target.value
              setSearch(next)
              if (next.trim() === query) {
                searchController.current?.abort()
                setSearching(false)
              }
            }}
            maxLength={80}
            placeholder="For example, bamboo"
          />
        </Field>
        <output className="mt-3 block text-sm text-muted" aria-live="polite">
          {searching
            ? 'Searching...'
            : `${page.items.length} brands on this page`}
        </output>
      </Card>

      {feedback.error ? (
        <Notice title={feedback.error} tone="danger">
          {feedback.issues.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5">
              {feedback.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
          {feedback.conflict ? (
            <Button
              variant="secondary"
              className="mt-3"
              onClick={() => void reloadPage()}
            >
              Reload brand list
            </Button>
          ) : null}
        </Notice>
      ) : null}
      {feedback.success ? (
        <Notice tone="success">{feedback.success}</Notice>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2 xl:items-start">
        <BrandForm
          title="Add brand"
          description="Leave the slug blank to generate it from the name."
          values={createValues}
          issues={feedback.issues}
          pending={pending}
          submitLabel="Create brand"
          onChange={setCreateValues}
          onSubmit={create}
        />
        {editing ? (
          <div id="brand-editor" className="scroll-mt-6">
            <BrandForm
              title={`Edit ${editing.name}`}
              description="Changing the explicit slug changes the future public URL and requires confirmation."
              values={editValues}
              issues={feedback.issues}
              pending={pending}
              submitLabel="Save brand"
              onChange={setEditValues}
              onSubmit={saveEdit}
              onCancel={() => setEditing(null)}
            />
          </div>
        ) : (
          <Card className="border-dashed">
            <h2 className="font-semibold">Edit a brand</h2>
            <p className="mt-2 text-sm text-muted">
              Choose Edit beside a brand to change its name, slug, or active
              state.
            </p>
          </Card>
        )}
      </div>

      {page.items.length === 0 ? (
        <EmptyState
          title={query ? 'No matching brands' : 'No brands yet'}
          description={
            query
              ? 'Change or clear the search term to see other brands.'
              : 'Create the first brand for seller listing forms.'
          }
        />
      ) : (
        <ResponsiveDataList
          table={
            <DataTable>
              <thead className="bg-surface-subtle text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Brand</th>
                  <th className="px-4 py-3 font-semibold">Slug</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Updated</th>
                  <th className="px-4 py-3 text-right font-semibold">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {page.items.map((brand) => (
                  <tr key={brand.id}>
                    <td className="px-4 py-4 font-semibold">{brand.name}</td>
                    <td className="px-4 py-4">{brand.slug}</td>
                    <td className="px-4 py-4">
                      <StatusBadge
                        tone={brand.isActive ? 'success' : 'warning'}
                      >
                        {brand.isActive ? 'Active' : 'Inactive'}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-4">
                      {formatIndianDate(brand.updatedAt)}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => openEdit(brand)}
                          disabled={pending}
                        >
                          Edit
                        </Button>
                        <BrandDelete
                          brand={brand}
                          pending={pending}
                          onDelete={() => void remove(brand)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          }
          cards={page.items.map((brand) => (
            <DataCard key={brand.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-semibold">{brand.name}</h2>
                  <p className="mt-1 break-words text-sm text-muted">
                    {brand.slug}
                  </p>
                </div>
                <StatusBadge tone={brand.isActive ? 'success' : 'warning'}>
                  {brand.isActive ? 'Active' : 'Inactive'}
                </StatusBadge>
              </div>
              <p className="mt-3 text-sm text-muted">
                Updated {formatIndianDate(brand.updatedAt)}
              </p>
              <div className="mt-4 flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => openEdit(brand)}
                  disabled={pending}
                >
                  Edit
                </Button>
                <BrandDelete
                  brand={brand}
                  pending={pending}
                  onDelete={() => void remove(brand)}
                />
              </div>
            </DataCard>
          ))}
        />
      )}

      {(cursor || page.nextCursor) && (
        <nav
          aria-label="Brand pages"
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <PaginationButton
            onClick={() => void previousPage()}
            disabled={pending || history.length === 0}
          >
            Previous page
          </PaginationButton>
          <span className="text-sm text-muted">
            Search: {query || 'All brands'}
          </span>
          <PaginationButton
            onClick={() => void loadPage(page.nextCursor ?? undefined)}
            disabled={pending || !page.nextCursor}
          >
            Next page
          </PaginationButton>
        </nav>
      )}
    </div>
  )
}

function BrandForm({
  title,
  description,
  values,
  issues,
  pending,
  submitLabel,
  onChange,
  onSubmit,
  onCancel,
}: {
  title: string
  description: string
  values: BrandFormValues
  issues: string[]
  pending: boolean
  submitLabel: string
  onChange: (values: BrandFormValues) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancel?: () => void
}) {
  const error = (path: string) =>
    issuesFor(issues, path).join('. ') || undefined
  const prefix = onCancel ? 'edit-brand' : 'new-brand'
  return (
    <Card className="p-0">
      <form onSubmit={onSubmit} noValidate>
        <div className="border-b p-5">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted">{description}</p>
        </div>
        <div className="grid gap-4 p-5">
          <Field
            label="Name"
            htmlFor={`${prefix}-name`}
            error={error('name')}
            required
          >
            <Input
              value={values.name}
              onChange={(event) =>
                onChange({ ...values, name: event.target.value })
              }
              disabled={pending}
            />
          </Field>
          <Field
            label="Slug"
            htmlFor={`${prefix}-slug`}
            hint={
              onCancel
                ? 'Explicit slug used in the future public URL.'
                : 'Optional. Blank means EcoKart generates it.'
            }
            error={error('slug')}
            required={Boolean(onCancel)}
          >
            <Input
              value={values.slug}
              onChange={(event) =>
                onChange({ ...values, slug: event.target.value })
              }
              disabled={pending}
            />
          </Field>
          <label
            htmlFor={`${prefix}-active`}
            className="flex min-h-11 items-center gap-3 rounded-lg border bg-surface-subtle px-4 py-3"
          >
            <Checkbox
              id={`${prefix}-active`}
              checked={values.isActive}
              onChange={(event) =>
                onChange({ ...values, isActive: event.target.checked })
              }
              disabled={pending}
            />
            <span>
              <span className="block font-medium">Active brand</span>
              <span className="block text-sm text-muted">
                Inactive brands remain here but are hidden from public and
                seller choices.
              </span>
            </span>
          </label>
        </div>
        <div className="flex flex-wrap justify-end gap-3 border-t bg-surface-subtle p-5">
          {onCancel ? (
            <Button variant="secondary" onClick={onCancel} disabled={pending}>
              Cancel
            </Button>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving...' : submitLabel}
          </Button>
        </div>
      </form>
    </Card>
  )
}

function BrandDelete({
  brand,
  pending,
  onDelete,
}: {
  brand: Brand
  pending: boolean
  onDelete: () => void
}) {
  return (
    <ConfirmationDialog
      title={`Delete ${brand.name}?`}
      description="Deletion succeeds only when no product uses this brand. Deactivate an in-use brand instead."
      trigger="Delete"
      triggerVariant="danger"
      confirmLabel="Delete brand"
      onConfirm={onDelete}
      danger
      triggerDisabled={pending}
      confirmDisabled={pending}
    />
  )
}
