'use client'

import { useEffect, useState } from 'react'
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  MAX_IMPORT_COLUMNS,
} from '@ecokart/core/catalogue-contracts'
import { Button, LinkButton } from '@/components/ui/button'
import { Card, Notice } from '@/components/ui/feedback'
import { Field, Input, Select } from '@/components/ui/form-controls'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { apiRequest, ApiError } from '@/lib/api-client'
import {
  uploadCatalogueFile,
  mappingInput,
  type CatalogueImport,
  type CatalogueImportSummary,
  type UploadForm,
} from '@/lib/catalogue-operations'
import { useClientReady } from '@/lib/use-client-ready'

export function ImportList() {
  const [items, setItems] = useState<CatalogueImportSummary[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [revision, setRevision] = useState(0)
  const ready = useClientReady()
  useEffect(() => {
    let active = true
    apiRequest<{ items: CatalogueImportSummary[]; nextCursor: string | null }>(
      `/api/seller/imports?refresh=${revision}`,
    )
      .then((result) => {
        if (active) {
          setItems(result.items)
          setCursor(result.nextCursor)
        }
        return undefined
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message)
      })
    return () => {
      active = false
    }
  }, [revision])
  async function more() {
    setPending(true)
    setError(null)
    try {
      const result = await apiRequest<{
        items: CatalogueImportSummary[]
        nextCursor: string | null
      }>(`/api/seller/imports?cursor=${encodeURIComponent(cursor!)}`)
      setItems((old) => [...old, ...result.items])
      setCursor(result.nextCursor)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The operation failed. Please refresh and try again.',
      )
    } finally {
      setPending(false)
    }
  }
  async function upload(file: File) {
    setError(null)
    if (
      !/\.(csv|xlsx)$/i.test(file.name) ||
      file.size < 1 ||
      file.size > MAX_IMPORT_BYTES
    ) {
      setError('Choose a non-empty CSV or XLSX file of 10 MB or smaller.')
      return
    }
    setPending(true)
    try {
      const key = await uploadCatalogueFile(
        file,
        async () =>
          (
            await apiRequest<{ upload: UploadForm }>(
              '/api/seller/imports/uploads',
              {
                method: 'POST',
                json: { fileName: file.name, size: file.size },
              },
            )
          ).upload,
      )
      const result = await apiRequest<{ import: CatalogueImport }>(
        '/api/seller/imports',
        { method: 'POST', json: { uploadKey: key, fileName: file.name } },
      )
      window.location.assign(`/seller/imports/${result.import.id}`)
    } catch (cause) {
      setError(
        (cause instanceof Error
          ? cause.message
          : 'The operation failed. Please refresh and try again.') +
          ' Refresh the imports list before uploading again; registration may have succeeded.',
      )
      setRevision((value) => value + 1)
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="grid gap-5">
      <Card>
        <form autoComplete="off" onSubmit={(event) => event.preventDefault()}>
          <h2 className="text-lg font-semibold">Upload catalogue</h2>
          <p className="my-3 text-sm">
            CSV or XLSX, up to 10 MB, {MAX_IMPORT_ROWS} rows and{' '}
            {MAX_IMPORT_COLUMNS} columns. Each valid row creates one draft with
            one variant. You review the mapping before importing.
          </p>
          <Field label="Catalogue file" htmlFor="catalogue-file">
            <Input
              type="file"
              accept=".csv,.xlsx"
              disabled={!ready || pending}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) void upload(file)
              }}
            />
          </Field>
          {pending ? <output className="block">Working…</output> : null}
        </form>
      </Card>
      {error ? <Notice title={error} tone="danger" /> : null}
      <Button
        variant="secondary"
        onClick={() => setRevision((value) => value + 1)}
        disabled={pending}
      >
        Refresh imports
      </Button>
      {items.length === 0 ? (
        <p>No imports to show.</p>
      ) : (
        items.map((item) => (
          <Card key={item.id}>
            <h2 className="break-all font-semibold">{item.fileName}</h2>
            <p>
              {item.status.replaceAll('_', ' ')}: {item.okRows} imported,{' '}
              {item.errorRows} failed, {item.totalRows} total rows
            </p>
            <LinkButton
              href={{ pathname: `/seller/imports/${item.id}` }}
              variant="secondary"
            >
              Open import
            </LinkButton>
          </Card>
        ))
      )}
      {cursor ? (
        <Button onClick={() => void more()} disabled={pending}>
          Load more imports
        </Button>
      ) : null}
    </div>
  )
}

export function ImportDetail({
  initialImport,
}: {
  initialImport: CatalogueImport
}) {
  const [item, setItem] = useState(initialImport)
  const [mapping, setMapping] = useState<Record<string, string>>(
    () =>
      initialImport.columnMapping ??
      Object.fromEntries(
        Object.entries(initialImport.suggestedMapping ?? {})
          .filter(([, suggestion]) => suggestion.source === 'name')
          .map(([header, suggestion]) => [header, suggestion.field]),
      ),
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [expired, setExpired] = useState(false)
  const ready = useClientReady()
  async function refresh() {
    const result = await apiRequest<{ import: CatalogueImport }>(
      `/api/seller/imports/${item.id}`,
    )
    setItem(result.import)
    return result.import
  }
  useEffect(() => {
    if (
      !['uploaded', 'mapping_confirmed', 'validating', 'importing'].includes(
        item.status,
      )
    )
      return undefined
    let active = true
    let attempts = 0
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const result = await apiRequest<{ import: CatalogueImport }>(
          `/api/seller/imports/${item.id}`,
        )
        if (!active) return
        setItem(result.import)
        if (result.import.status === 'mapping_suggested') {
          setMapping((current) =>
            Object.keys(current).length
              ? current
              : Object.fromEntries(
                  Object.entries(result.import.suggestedMapping ?? {})
                    .filter(([, suggestion]) => suggestion.source === 'name')
                    .map(([header, suggestion]) => [header, suggestion.field]),
                ),
          )
          return
        }
        if (
          ![
            'uploaded',
            'mapping_confirmed',
            'validating',
            'importing',
          ].includes(result.import.status)
        )
          return
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : 'The operation failed. Please refresh and try again.',
          )
      }
      if (active && ++attempts < 120)
        timer = setTimeout(() => void poll(), 2000)
      else if (active) setExpired(true)
    }
    timer = setTimeout(() => void poll(), 1000)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [item.id, item.status])
  async function confirm() {
    setError(null)
    setPending(true)
    try {
      const columnMapping = mappingInput(mapping, item.fields)
      const result = await apiRequest<{ import: CatalogueImport }>(
        `/api/seller/imports/${item.id}/mapping`,
        { method: 'PUT', json: { columnMapping } },
      )
      setItem(result.import)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The operation failed. Please refresh and try again.',
      )
      if (cause instanceof ApiError && cause.status === 409)
        await refresh().catch(() => undefined)
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="grid gap-5">
      <Card>
        <h2 className="break-all text-lg font-semibold">{item.fileName}</h2>
        <output className="block">
          Import status: {item.status.replaceAll('_', ' ')}
        </output>
        <p>
          {item.okRows} imported, {item.errorRows} failed, {item.totalRows}{' '}
          total rows
        </p>
        <p className="my-3 text-sm">
          Successful rows stay as drafts even if other rows fail. Add photos and
          review each draft before submission.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            onClick={() =>
              void refresh().catch((cause: Error) => setError(cause.message))
            }
          >
            Refresh import
          </Button>
          <LinkButton href="/seller/products?status=draft" variant="secondary">
            Review draft products
          </LinkButton>
          <LinkButton href="/seller/imports" variant="secondary">
            Back to imports
          </LinkButton>
        </div>
        {item.hasErrorReport ? (
          <a
            className="mt-4 block underline"
            href={`/api/seller/imports/${item.id}/error-report`}
          >
            Download row errors
          </a>
        ) : null}
      </Card>
      {error || item.error ? (
        <Notice title={error ?? item.error ?? ''} tone="danger" />
      ) : null}
      {expired ? (
        <output className="block">
          Processing is taking longer. Refresh to check progress; do not upload
          the same file again.
        </output>
      ) : null}
      {item.headers ? (
        <Card className="min-w-0">
          <h2 className="text-lg font-semibold">Column mapping</h2>
          <p className="my-3 text-sm">
            Choose each required field once. Ignore columns you do not need.
            Suggestions from column names need your confirmation.
          </p>
          <form autoComplete="off" onSubmit={(event) => event.preventDefault()}>
            <fieldset
              disabled={
                !ready || pending || item.status !== 'mapping_suggested'
              }
              className="grid gap-4 sm:grid-cols-2"
            >
              {item.headers.map((header, index) => (
                <Field
                  key={header}
                  label={header}
                  htmlFor={`column-${index}`}
                  hint={
                    item.fields.find((field) => field.field === mapping[header])
                      ?.hint
                  }
                >
                  <Select
                    value={mapping[header] ?? ''}
                    onChange={(event) =>
                      setMapping((current) => ({
                        ...current,
                        [header]: event.target.value,
                      }))
                    }
                  >
                    <option value="">Ignore column</option>
                    {item.fields.map((field) => (
                      <option key={field.field} value={field.field}>
                        {field.label}
                        {field.required ? ' (required)' : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </fieldset>
            <div className="mt-5">
              <ConfirmationDialog
                title="Confirm catalogue import?"
                description="Valid rows create drafts. Invalid rows are listed separately in an error report. Confirm this mapping once."
                trigger="Confirm mapping and import"
                confirmLabel="Start import"
                onConfirm={() => void confirm()}
                triggerDisabled={
                  !ready || pending || item.status !== 'mapping_suggested'
                }
              />
            </div>
          </form>
          <h3 className="mt-6 font-semibold">Sample rows</h3>
          {/* Horizontal table scrolling must be reachable by keyboard. */}
          <section
            className="mt-2 w-full min-w-0 overflow-x-auto"
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            aria-label="Sample rows"
          >
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {item.headers.map((header) => (
                    <th className="p-2" key={header}>
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {item.sampleRows.map((row, index) => (
                  <tr key={index}>
                    {row.map((value, column) => (
                      <td className="max-w-48 break-words p-2" key={column}>
                        {value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </Card>
      ) : null}
    </div>
  )
}
