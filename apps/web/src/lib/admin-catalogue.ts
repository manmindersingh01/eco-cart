import {
  parsePercentToBasisPoints,
  parseWholeNumber,
  type ParseResult,
} from './admin-settings'

export type CategoryNode = {
  id: string
  parentId: string | null
  name: string
  slug: string
  depth: number
  gstRateBps: number
  defaultHsnCode: string | null
  sortOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
  children: CategoryNode[]
}

export type FlatCategory = Omit<CategoryNode, 'children'> & {
  path: string[]
  levelsBelow: number
}

export type Brand = {
  id: string
  name: string
  slug: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type CategoryFormValues = {
  name: string
  slug: string
  parentId: string
  gstPercent: string
  defaultHsnCode: string
  sortOrder: string
  isActive: boolean
}

export type BrandFormValues = {
  name: string
  slug: string
  isActive: boolean
}

function levelsBelow(node: CategoryNode): number {
  if (node.children.length === 0) return 0
  return 1 + Math.max(...node.children.map(levelsBelow))
}

export function flattenCategoryTree(
  nodes: readonly CategoryNode[],
  parentPath: readonly string[] = [],
): FlatCategory[] {
  return nodes.flatMap((node) => {
    const path = [...parentPath, node.name]
    const { children, ...category } = node
    return [
      { ...category, path, levelsBelow: levelsBelow(node) },
      ...flattenCategoryTree(children, path),
    ]
  })
}

export function categoryParentOptions(
  nodes: readonly CategoryNode[],
  editingId?: string,
): FlatCategory[] {
  const flat = flattenCategoryTree(nodes)
  const editing = editingId
    ? flat.find((category) => category.id === editingId)
    : undefined
  const excluded = new Set(
    editingId ? categorySubtreeIds(nodes, editingId) : [],
  )
  const movingLevels = editing?.levelsBelow ?? 0
  return flat.filter(
    (category) =>
      !excluded.has(category.id) && category.depth + 1 + movingLevels <= 2,
  )
}

function categorySubtreeIds(
  nodes: readonly CategoryNode[],
  id: string,
): string[] {
  for (const node of nodes) {
    if (node.id === id) {
      return [
        node.id,
        ...node.children.flatMap((child) =>
          categorySubtreeIds([child], child.id),
        ),
      ]
    }
    const found = categorySubtreeIds(node.children, id)
    if (found.length > 0) return found
  }
  return []
}

export function categoryValues(category?: FlatCategory): CategoryFormValues {
  if (!category) {
    return {
      name: '',
      slug: '',
      parentId: '',
      gstPercent: '',
      defaultHsnCode: '',
      sortOrder: '0',
      isActive: true,
    }
  }
  return {
    name: category.name,
    slug: category.slug,
    parentId: category.parentId ?? '',
    gstPercent: basisPointsInput(category.gstRateBps),
    defaultHsnCode: category.defaultHsnCode ?? '',
    sortOrder: String(category.sortOrder),
    isActive: category.isActive,
  }
}

function basisPointsInput(value: number): string {
  const whole = Math.floor(value / 100)
  const fraction = String(value % 100)
    .padStart(2, '0')
    .replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}

export function serialiseCategory(
  values: CategoryFormValues,
  mode: 'create' | 'edit',
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const gst = parsePercentToBasisPoints(values.gstPercent)
  if (!gst.ok) return gst
  const sortOrder = parseWholeNumber(values.sortOrder, 'Sort order')
  if (!sortOrder.ok) return sortOrder
  const common = {
    name: values.name,
    parentId: values.parentId || null,
    gstRateBps: gst.value,
    defaultHsnCode: values.defaultHsnCode.trim() || null,
    sortOrder: sortOrder.value,
    isActive: values.isActive,
  }
  return {
    ok: true,
    value:
      mode === 'create' && !values.slug.trim()
        ? common
        : { ...common, slug: values.slug },
  }
}

export function formatGstRate(basisPoints: number): string {
  return `${basisPointsInput(basisPoints)}%`
}

export function brandListHref(
  query: string,
  cursor?: string,
): '/admin/brands' | `/admin/brands?${string}` {
  const params = new URLSearchParams()
  if (query) params.set('q', query)
  if (cursor) params.set('cursor', cursor)
  const encoded = params.toString()
  return encoded ? `/admin/brands?${encoded}` : '/admin/brands'
}

export function brandApiPath(query: string, cursor?: string): string {
  const params = new URLSearchParams({ limit: '20' })
  if (query) params.set('q', query)
  if (cursor) params.set('cursor', cursor)
  return `/api/admin/brands?${params}`
}

export function serialiseBrand(
  values: BrandFormValues,
  mode: 'create' | 'edit',
): Record<string, unknown> {
  const common = { name: values.name, isActive: values.isActive }
  return mode === 'create' && !values.slug.trim()
    ? common
    : { ...common, slug: values.slug }
}

export function parseCatalogueWholeNumber(
  raw: string,
  label: string,
): ParseResult {
  return parseWholeNumber(raw, label)
}

export function replaceAbortController(
  previous?: AbortController,
): AbortController {
  previous?.abort()
  return new AbortController()
}
