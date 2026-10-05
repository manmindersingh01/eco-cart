/*
 * The category tree in memory (design doc section 7). One query loads every
 * category, and these functions answer menus, breadcrumbs, and "everything
 * below this category" without recursive SQL. The tree holds a few hundred
 * categories at most, so every answer is a quick walk.
 */

/** The depth of the lowest level: three levels in all (0, 1, and 2). */
export const MAX_CATEGORY_DEPTH = 2

/** What the tree needs to know about a category. */
export interface TreeCategory {
  id: string
  parentId: string | null
  name: string
  slug: string
  sortOrder: number
  isActive: boolean
}

export interface CategoryTree<C extends TreeCategory> {
  /** Every category, in no particular order. */
  readonly categories: readonly C[]
  byId(id: string): C | undefined
  bySlug(slug: string): C | undefined
  /** The categories directly inside `parentId` (null: the top level), in display order. */
  childrenOf(parentId: string | null): C[]
  /** From the top level down to the category itself, for breadcrumbs. */
  pathTo(id: string): C[]
  /** The category and every category below it, for example to list all their products. */
  subtreeIds(id: string): string[]
  /** How many levels sit below the category: 0 when it has no subcategories. */
  levelsBelow(id: string): number
  /** Whether the category and every category above it are active. */
  isVisible(id: string): boolean
  /**
   * Nested nodes in display order. A category that `include` refuses is left
   * out together with everything below it.
   */
  nest<N>(
    build: (category: C, children: N[]) => N,
    include?: (category: C) => boolean,
  ): N[]
}

/** Siblings show by sort order, then by name. */
const displayOrder = (a: TreeCategory, b: TreeCategory) =>
  a.sortOrder - b.sortOrder ||
  a.name.localeCompare(b.name, 'en-IN', { sensitivity: 'base' }) ||
  (a.id < b.id ? -1 : 1)

export function buildCategoryTree<C extends TreeCategory>(
  categories: readonly C[],
): CategoryTree<C> {
  const byId = new Map(categories.map((category) => [category.id, category]))
  const bySlug = new Map(
    categories.map((category) => [category.slug, category]),
  )
  const children = new Map<string | null, C[]>()
  for (const category of categories.toSorted(displayOrder)) {
    const siblings = children.get(category.parentId) ?? []
    siblings.push(category)
    children.set(category.parentId, siblings)
  }
  const childrenOf = (parentId: string | null) => children.get(parentId) ?? []

  function pathTo(id: string): C[] {
    const path: C[] = []
    for (
      let current = byId.get(id);
      current;
      current =
        current.parentId === null ? undefined : byId.get(current.parentId)
    ) {
      // The service never saves a loop; this stops a hand-edited one from
      // hanging the request.
      if (path.length > MAX_CATEGORY_DEPTH) {
        throw new Error(`The category tree above ${id} is broken`)
      }
      path.unshift(current)
    }
    return path
  }

  function subtreeIds(id: string): string[] {
    if (!byId.has(id)) return []
    const ids = [id]
    for (let next = 0; next < ids.length; next++) {
      for (const child of childrenOf(ids[next]!)) ids.push(child.id)
    }
    return ids
  }

  function levelsBelow(id: string): number {
    return Math.max(
      0,
      ...childrenOf(id).map((child) => 1 + levelsBelow(child.id)),
    )
  }

  function nest<N>(
    build: (category: C, children: N[]) => N,
    include: (category: C) => boolean = () => true,
  ): N[] {
    const walk = (parentId: string | null): N[] =>
      childrenOf(parentId)
        .filter(include)
        .map((category) => build(category, walk(category.id)))
    return walk(null)
  }

  return {
    categories,
    byId: (id) => byId.get(id),
    bySlug: (slug) => bySlug.get(slug),
    childrenOf,
    pathTo,
    subtreeIds,
    levelsBelow,
    isVisible: (id) => {
      const path = pathTo(id)
      return path.length > 0 && path.every((category) => category.isActive)
    },
    nest,
  }
}
