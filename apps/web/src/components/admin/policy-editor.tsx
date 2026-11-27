'use client'

import { useDeferredValue, useId, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, LinkButton } from '@/components/ui/button'
import { Card, Notice, StatusBadge } from '@/components/ui/feedback'
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls'
import { PolicyMarkdown } from '@/components/ui/policy-markdown'
import { ApiError, apiRequest } from '@/lib/api-client'
import { useClientReady } from '@/lib/use-client-ready'

type PolicyData = {
  slug: string
  title: string
  bodyMarkdown: string
  status: 'draft' | 'published'
  saved: boolean
}
export function PolicyEditor({ initial }: { initial: PolicyData }) {
  const router = useRouter()
  const id = useId()
  const ready = useClientReady()
  const lock = useRef(false)
  const [values, setValues] = useState(initial)
  const [current, setCurrent] = useState(initial)
  const [preview, setPreview] = useState(false)
  const previewText = useDeferredValue(values.bodyMarkdown)
  const [saving, setSaving] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const [problem, setProblem] = useState('')
  const [saved, setSaved] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const disabled = !ready || saving || refreshing || uncertain
  return (
    <div className="grid min-w-0 gap-6">
      <Card>
        <form
          className="grid gap-4"
          aria-label="Policy editor"
          onSubmit={async (event) => {
            event.preventDefault()
            if (lock.current || disabled) return
            lock.current = true
            setSaving(true)
            setProblem('')
            setSaved(false)
            try {
              const { page } = await apiRequest<{ page: PolicyData }>(
                `/api/admin/content/${initial.slug}`,
                {
                  method: 'PUT',
                  json: {
                    title: values.title,
                    bodyMarkdown: values.bodyMarkdown,
                    status: values.status,
                  },
                },
              )
              setValues(page)
              setCurrent(page)
              setSaved(true)
              startTransition(() => router.refresh())
            } catch (cause) {
              setUncertain(!(cause instanceof ApiError) || cause.status >= 500)
              setProblem(
                cause instanceof ApiError
                  ? [cause.message, ...cause.issues].join(' ')
                  : 'The result could not be confirmed. Reload the page to check its saved version before trying again.',
              )
            } finally {
              setSaving(false)
              lock.current = false
            }
          }}
        >
          <p>
            Last saved:{' '}
            <StatusBadge
              tone={current.status === 'published' ? 'success' : 'neutral'}
            >
              {current.saved
                ? current.status === 'published'
                  ? 'Published'
                  : 'Draft'
                : 'Unwritten draft'}
            </StatusBadge>
          </p>
          <p className="text-sm text-muted">
            Only published pages are public. Saving as a draft removes a
            published page from the shop. Use client-approved legal text before
            publishing for launch.
          </p>
          {saved ? (
            <Notice tone="success">
              Page saved as {current.status}. Public changes may take a few
              seconds to appear.
            </Notice>
          ) : null}
          {problem ? (
            <Notice tone="danger" title="Page could not be saved">
              <p>{problem}</p>
              {uncertain ? (
                <Button
                  className="mt-3"
                  variant="secondary"
                  onClick={() => window.location.reload()}
                >
                  Reload saved page
                </Button>
              ) : null}
            </Notice>
          ) : null}
          <Field label="Page title" htmlFor={`${id}-title`} required>
            <Input
              required
              maxLength={120}
              value={values.title}
              disabled={disabled}
              onChange={(event) =>
                setValues((old) => ({ ...old, title: event.target.value }))
              }
            />
          </Field>
          <Field
            label="Policy text (Markdown)"
            htmlFor={`${id}-body`}
            hint="Use ## for headings, blank lines for paragraphs, - for lists and [label](https://example.com) for links. Raw HTML and images are not rendered."
          >
            <Textarea
              className="min-h-80 font-mono text-sm"
              maxLength={50000}
              value={values.bodyMarkdown}
              disabled={disabled}
              onChange={(event) =>
                setValues((old) => ({
                  ...old,
                  bodyMarkdown: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Save as" htmlFor={`${id}-status`}>
            <Select
              value={values.status}
              disabled={disabled}
              onChange={(event) =>
                setValues((old) => ({
                  ...old,
                  status:
                    event.target.value === 'published' ? 'published' : 'draft',
                }))
              }
            >
              <option value="draft">Draft (private)</option>
              <option value="published">Published (public)</option>
            </Select>
          </Field>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={disabled}>
              {saving
                ? 'Saving...'
                : values.status === 'published'
                  ? 'Publish page'
                  : 'Save draft'}
            </Button>
            <Button
              variant="secondary"
              disabled={!ready}
              aria-expanded={preview}
              aria-controls={`${id}-preview`}
              onClick={() => setPreview(!preview)}
            >
              {preview ? 'Hide preview' : 'Show preview'}
            </Button>
            {current.status === 'published' ? (
              <LinkButton
                href={`/policies/${initial.slug}`}
                variant="secondary"
              >
                View public page
              </LinkButton>
            ) : null}
          </div>
        </form>
      </Card>
      {preview ? (
        <section
          id={`${id}-preview`}
          aria-label="Policy preview"
          className="min-w-0"
        >
          <Card className="grid min-w-0 gap-4">
            <h2 className="text-lg font-semibold">Preview (unsaved)</h2>
            <p className="text-2xl font-semibold break-words">{values.title}</p>
            <PolicyMarkdown>{previewText}</PolicyMarkdown>
          </Card>
        </section>
      ) : null}
    </div>
  )
}
