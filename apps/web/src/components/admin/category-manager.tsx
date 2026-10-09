'use client'

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Card, Notice, StatusBadge } from '@/components/ui/feedback'
import { Checkbox, Field, Input, Select } from '@/components/ui/form-controls'
import { issuesFor } from '@/lib/admin-settings'
import {
  categoryParentOptions,
  categoryValues,
  flattenCategoryTree,
  formatGstRate,
  serialiseCategory,
  type CategoryFormValues,
  type CategoryNode,
  type FlatCategory,
} from '@/lib/admin-catalogue'
import { ApiError, apiRequest } from '@/lib/api-client'

type Editor =
  | { mode: 'create'; parentId: string }
  | { mode: 'edit'; category: FlatCategory }

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

export function CategoryManager({
  initialTree,
}: {
  initialTree: CategoryNode[]
}) {
  const [tree, setTree] = useState(initialTree)
  const [editor, setEditor] = useState<Editor>({ mode: 'create', parentId: '' })
  const [values, setValues] = useState<CategoryFormValues>(() =>
    categoryValues(),
  )
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState(idleFeedback)
  const flat = flattenCategoryTree(tree)
  const editingId = editor.mode === 'edit' ? editor.category.id : undefined
  const parentOptions = categoryParentOptions(tree, editingId)

  async function refreshTree() {
    const response = await apiRequest<{ categories: CategoryNode[] }>(
      '/api/admin/categories',
    )
    setTree(response.categories)
    return response.categories
  }

  function openCreate(parentId = '') {
    const next = categoryValues()
    next.parentId = parentId
    setEditor({ mode: 'create', parentId })
    setValues(next)
    setFeedback(idleFeedback)
    document
      .getElementById('category-editor')
      ?.scrollIntoView({ block: 'start' })
  }

  function openEdit(category: FlatCategory) {
    setEditor({ mode: 'edit', category })
    setValues(categoryValues(category))
    setFeedback(idleFeedback)
    document
      .getElementById('category-editor')
      ?.scrollIntoView({ block: 'start' })
  }

  function handleError(cause: unknown) {
    if (cause instanceof ApiError) {
      if (cause.status === 401) {
        window.location.assign(
          '/sign-in?returnTo=%2Fadmin%2Fcategories&reason=session-ended',
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
      error: 'The category change failed. Check your connection and try again.',
    })
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = serialiseCategory(values, editor.mode)
    if (!input.ok) {
      setFeedback({ ...idleFeedback, error: input.error })
      return
    }
    if (
      editor.mode === 'edit' &&
      values.slug !== editor.category.slug &&
      !window.confirm(
        "Changing this slug changes the category's future public URL. Continue?",
      )
    ) {
      return
    }

    setPending(true)
    setFeedback(idleFeedback)
    try {
      if (editor.mode === 'create') {
        await apiRequest('/api/admin/categories', {
          method: 'POST',
          json: input.value,
        })
      } else {
        await apiRequest(`/api/admin/categories/${editor.category.id}`, {
          method: 'PATCH',
          json: input.value,
        })
      }
      const currentTree = await refreshTree()
      setFeedback({
        ...idleFeedback,
        success:
          editor.mode === 'create' ? 'Category created.' : 'Category updated.',
      })
      if (editor.mode === 'create') {
        const next = categoryValues()
        next.parentId = editor.parentId
        setValues(next)
      } else {
        const updated = flattenCategoryTree(currentTree).find(
          (category) => category.id === editor.category.id,
        )
        if (updated) {
          setEditor({ mode: 'edit', category: updated })
          setValues(categoryValues(updated))
        }
      }
    } catch (cause) {
      handleError(cause)
    } finally {
      setPending(false)
    }
  }

  async function remove(category: FlatCategory) {
    setPending(true)
    setFeedback(idleFeedback)
    try {
      await apiRequest<void>(`/api/admin/categories/${category.id}`, {
        method: 'DELETE',
      })
      await refreshTree()
      if (editor.mode === 'edit' && editor.category.id === category.id) {
        openCreate()
      }
      setFeedback({ ...idleFeedback, success: `${category.name} was deleted.` })
    } catch (cause) {
      handleError(cause)
    } finally {
      setPending(false)
    }
  }

  const error = (path: string) =>
    issuesFor(feedback.issues, path).join('. ') || undefined

  return (
    <div className="grid gap-7 xl:grid-cols-[minmax(0,1.15fr)_minmax(24rem,0.85fr)] xl:items-start">
      <section aria-labelledby="category-tree-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="category-tree-title" className="text-xl font-semibold">
              Category tree
            </h2>
            <p className="mt-1 text-sm text-muted">
              Categories appear in sort-order sequence at each level.
            </p>
          </div>
          <Button variant="secondary" onClick={() => openCreate()}>
            Add top-level category
          </Button>
        </div>
        {tree.length === 0 ? (
          <Card className="mt-4 text-center">
            <p className="font-semibold">No categories yet</p>
            <p className="mt-1 text-sm text-muted">
              Add the first top-level category to begin the catalogue tree.
            </p>
          </Card>
        ) : (
          <ol className="mt-4 grid gap-3">
            {tree.map((category) => (
              <CategoryBranch
                key={category.id}
                category={category}
                flat={flat}
                pending={pending}
                onCreate={openCreate}
                onEdit={openEdit}
                onDelete={(item) => void remove(item)}
              />
            ))}
          </ol>
        )}
      </section>

      <Card id="category-editor" className="scroll-mt-6 p-0 xl:sticky xl:top-6">
        <form onSubmit={submit} noValidate>
          <div className="border-b p-5">
            <h2 className="text-lg font-semibold">
              {editor.mode === 'create'
                ? editor.parentId
                  ? 'Add child category'
                  : 'Add top-level category'
                : `Edit ${editor.category.name}`}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {editor.mode === 'create'
                ? 'Leave the slug blank to generate it from the name.'
                : 'An explicit slug is required while editing. Changing it changes the future public URL.'}
            </p>
          </div>
          <div className="grid gap-4 p-5">
            <Field
              label="Name"
              htmlFor="category-name"
              error={error('name')}
              required
            >
              <Input
                value={values.name}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                disabled={pending}
              />
            </Field>
            <Field
              label="Slug"
              htmlFor="category-slug"
              hint={
                editor.mode === 'create'
                  ? 'Optional. Blank means EcoKart generates it.'
                  : 'Lowercase letters, digits, and single hyphens.'
              }
              error={error('slug')}
              required={editor.mode === 'edit'}
            >
              <Input
                value={values.slug}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    slug: event.target.value,
                  }))
                }
                disabled={pending}
              />
            </Field>
            <Field
              label="Parent category"
              htmlFor="category-parent"
              hint="Only choices that keep this tree within three levels are shown."
              error={error('parentId')}
            >
              <Select
                value={values.parentId}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    parentId: event.target.value,
                  }))
                }
                disabled={pending}
              >
                <option value="">No parent - top level</option>
                {parentOptions.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.path.join(' > ')}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="GST percentage"
                htmlFor="category-gst"
                hint="For example, 5 or 0.25. The backend accepts only current GST rates."
                error={error('gstRateBps')}
                required
              >
                <Input
                  value={values.gstPercent}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      gstPercent: event.target.value,
                    }))
                  }
                  inputMode="decimal"
                  disabled={pending}
                />
              </Field>
              <Field
                label="Default HSN code"
                htmlFor="category-hsn"
                hint="Optional. Clearing this field sends null."
                error={error('defaultHsnCode')}
              >
                <Input
                  value={values.defaultHsnCode}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      defaultHsnCode: event.target.value,
                    }))
                  }
                  inputMode="numeric"
                  disabled={pending}
                />
              </Field>
            </div>
            <Field
              label="Sort order"
              htmlFor="category-sort-order"
              hint="Lower numbers appear first among siblings."
              error={error('sortOrder')}
              required
            >
              <Input
                type="number"
                inputMode="numeric"
                min="0"
                max="10000"
                step="1"
                value={values.sortOrder}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    sortOrder: event.target.value,
                  }))
                }
                disabled={pending}
              />
            </Field>
            <label
              htmlFor="category-active"
              className="flex min-h-11 items-center gap-3 rounded-lg border bg-surface-subtle px-4 py-3"
            >
              <Checkbox
                id="category-active"
                checked={values.isActive}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    isActive: event.target.checked,
                  }))
                }
                disabled={pending}
              />
              <span>
                <span className="block font-medium">Active category</span>
                <span className="block text-sm text-muted">
                  Inactive categories remain here but are hidden publicly with
                  their branch.
                </span>
              </span>
            </label>
          </div>
          {feedback.error ? (
            <Notice title={feedback.error} tone="danger" className="mx-5 mb-5">
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
                  onClick={() => void refreshTree()}
                >
                  Reload category tree
                </Button>
              ) : null}
            </Notice>
          ) : null}
          {feedback.success ? (
            <Notice tone="success" className="mx-5 mb-5">
              {feedback.success}
            </Notice>
          ) : null}
          <div className="flex justify-end border-t bg-surface-subtle p-5">
            <Button type="submit" disabled={pending}>
              {pending
                ? 'Saving...'
                : editor.mode === 'create'
                  ? 'Create category'
                  : 'Save category'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

function CategoryBranch({
  category,
  flat,
  pending,
  onCreate,
  onEdit,
  onDelete,
}: {
  category: CategoryNode
  flat: FlatCategory[]
  pending: boolean
  onCreate: (parentId: string) => void
  onEdit: (category: FlatCategory) => void
  onDelete: (category: FlatCategory) => void
}) {
  const item = flat.find((candidate) => candidate.id === category.id)
  if (!item) return null
  return (
    <li>
      <Card className={category.depth > 0 ? 'ml-4 sm:ml-8' : undefined}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{category.name}</h3>
              <StatusBadge tone={category.isActive ? 'success' : 'warning'}>
                {category.isActive ? 'Active' : 'Inactive'}
              </StatusBadge>
              <StatusBadge>Level {category.depth + 1}</StatusBadge>
            </div>
            <dl className="mt-3 grid gap-x-5 gap-y-2 text-sm sm:grid-cols-2">
              <TreeDetail label="Slug" value={category.slug} />
              <TreeDetail
                label="GST"
                value={formatGstRate(category.gstRateBps)}
              />
              <TreeDetail
                label="Default HSN"
                value={category.defaultHsnCode ?? 'None'}
              />
              <TreeDetail
                label="Sort order"
                value={String(category.sortOrder)}
              />
            </dl>
            {category.depth === 2 ? (
              <p className="mt-3 text-sm text-muted">
                This is the lowest level. A fourth category level is
                unavailable.
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {category.depth < 2 ? (
              <Button
                variant="quiet"
                onClick={() => onCreate(category.id)}
                disabled={pending}
              >
                Add child
              </Button>
            ) : null}
            <Button
              variant="secondary"
              onClick={() => onEdit(item)}
              disabled={pending}
            >
              Edit
            </Button>
            <ConfirmationDialog
              title={`Delete ${category.name}?`}
              description="Deletion succeeds only when this category has no subcategories or products. Deactivate an in-use category instead."
              trigger="Delete"
              triggerVariant="danger"
              confirmLabel="Delete category"
              onConfirm={() => onDelete(item)}
              danger
              triggerDisabled={pending}
              confirmDisabled={pending}
            />
          </div>
        </div>
      </Card>
      {category.children.length > 0 ? (
        <ol className="mt-3 grid gap-3">
          {category.children.map((child) => (
            <CategoryBranch
              key={child.id}
              category={child}
              flat={flat}
              pending={pending}
              onCreate={onCreate}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </ol>
      ) : null}
    </li>
  )
}

function TreeDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5 break-words font-medium">{value}</dd>
    </div>
  )
}
