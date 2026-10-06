import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Transaction } from '../../db/client.ts'
import type { RequestContext } from '../../db/context.ts'
import { categories, products } from '../../db/schema/index.ts'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../errors.ts'
import { foreignKeyViolation, uniqueViolation } from '../../lib/postgres.ts'
import { firstFreeSlug, slugify } from '../../lib/slug.ts'
import { isUuid, parseInput } from '../../lib/validation.ts'
import { recordAuditEntry, type AuditEntry } from '../audit/service.ts'
import { refreshProducts } from './summary.ts'
import {
  buildCategoryTree,
  MAX_CATEGORY_DEPTH,
  type CategoryTree,
} from './tree.ts'
import {
  categoryUpdate,
  newCategory,
  type CategoryNode,
  type CategoryView,
  type PublicCategory,
} from './types.ts'

/*
 * The category tree with the GST rate and default HSN code of each category
 * (backend spec step 5, design doc 5.5). Administrators change it; anyone
 * reads the visible part.
 *
 * Every change first locks the table against other changes, so they happen
 * one at a time. Without it, two administrators moving categories at the
 * same moment could each pass the loop check and together create a loop.
 * Reading is never blocked by the lock.
 */

type CategoryRow = typeof categories.$inferSelect
type Administrator = Extract<RequestContext, { role: 'admin' | 'system' }>

const INVALID = 'Those category details are not valid'

function toView(row: CategoryRow): CategoryView {
  return {
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    slug: row.slug,
    depth: row.depth,
    gstRateBps: row.gstRateBps,
    defaultHsnCode: row.defaultHsnCode,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function assertAdministrator(
  context: RequestContext,
): asserts context is Administrator {
  if (context.role !== 'admin' && context.role !== 'system') {
    throw new ForbiddenError('Only administrators can manage categories')
  }
}

const administratorActor = (
  context: Administrator,
): Pick<AuditEntry, 'actorUserId' | 'actorRole'> => ({
  actorUserId: context.userId ?? null,
  actorRole: context.role,
})

/** The details an audit entry records, without the timestamps. */
function auditable(view: CategoryView) {
  const { createdAt: _created, updatedAt: _updated, ...details } = view
  return details
}

/** Every category, as a tree in memory. */
export async function loadCategoryTree(
  tx: Transaction,
): Promise<CategoryTree<CategoryView>> {
  const rows = await tx.select().from(categories)
  return buildCategoryTree(rows.map(toView))
}

/** Locks the table against other changes, then loads the tree. */
async function lockCategoryTree(
  tx: Transaction,
): Promise<CategoryTree<CategoryView>> {
  // SHARE ROW EXCLUSIVE conflicts with itself and with every write to the
  // table, but not with reads or with products pointing at a category.
  await tx.execute(sql`lock table ${categories} in share row exclusive mode`)
  return loadCategoryTree(tx)
}

/** The visible categories: active, below active parents. For anyone. */
export async function getCategoryTree(
  tx: Transaction,
): Promise<PublicCategory[]> {
  const tree = await loadCategoryTree(tx)
  return tree.nest<PublicCategory>(
    (category, children) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      gstRateBps: category.gstRateBps,
      defaultHsnCode: category.defaultHsnCode,
      children,
    }),
    (category) => category.isActive,
  )
}

/** Every category, active or not. Administrators only. */
export async function getFullCategoryTree(
  tx: Transaction,
  context: RequestContext,
): Promise<CategoryNode[]> {
  assertAdministrator(context)
  const tree = await loadCategoryTree(tx)
  return tree.nest<CategoryNode>((category, children) => ({
    ...category,
    children,
  }))
}

const placeName = (
  tree: CategoryTree<CategoryView>,
  parentId: string | null,
) =>
  parentId === null ? 'at the top level' : `in ${tree.byId(parentId)?.name}`

/** A problem with `name` among the categories in `parentId`, or null. */
function siblingNameIssue(
  tree: CategoryTree<CategoryView>,
  parentId: string | null,
  name: string,
  exceptId?: string,
): string | null {
  const taken = tree
    .childrenOf(parentId)
    .some(
      (sibling) =>
        sibling.id !== exceptId &&
        sibling.name.toLowerCase() === name.toLowerCase(),
    )
  return taken
    ? `name is already used by another category ${placeName(tree, parentId)}`
    : null
}

function slugIssue(
  tree: CategoryTree<CategoryView>,
  slug: string,
  exceptId?: string,
): string | null {
  const owner = tree.bySlug(slug)
  return owner && owner.id !== exceptId
    ? 'slug is already used by another category'
    : null
}

/** Turns a unique-constraint race into the message the pre-check gives. */
function explainUniqueViolation(error: unknown): unknown {
  const constraint = uniqueViolation(error)
  if (constraint === 'categories_parent_id_name_unique') {
    return new ValidationError(INVALID, [
      'name is already used by another category in the same place',
    ])
  }
  if (constraint === 'categories_slug_unique') {
    return new ValidationError(INVALID, [
      'slug is already used by another category',
    ])
  }
  return error
}

function throwIfAny(issues: (string | null)[]): void {
  const found = issues.filter((issue) => issue !== null)
  if (found.length > 0) throw new ValidationError(INVALID, found)
}

/** The parent a category would go into, and the depth it would get there. */
function placement(
  tree: CategoryTree<CategoryView>,
  parentId: string | null,
): { depth: number; issue: string | null } {
  if (parentId === null) return { depth: 0, issue: null }
  const parent = tree.byId(parentId)
  if (!parent) {
    return { depth: 0, issue: 'parentId is not an existing category' }
  }
  if (parent.depth >= MAX_CATEGORY_DEPTH) {
    return {
      depth: 0,
      issue: `parentId is already at the lowest level; categories go at most ${MAX_CATEGORY_DEPTH + 1} levels deep`,
    }
  }
  return { depth: parent.depth + 1, issue: null }
}

/**
 * Products sit only in categories without subcategories (backend spec step
 * 6), so a category that has products cannot become a parent.
 */
async function parentHasProductsIssue(
  tx: Transaction,
  parentId: string | null,
): Promise<string | null> {
  if (parentId === null) return null
  const [listed] = await tx
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.categoryId, parentId), isNull(products.deletedAt)))
    .limit(1)
  return listed
    ? 'parentId has products listed in it, so it cannot have subcategories'
    : null
}

/** Creates a category. Administrators only. */
export async function createCategory(
  tx: Transaction,
  context: RequestContext,
  input: unknown,
  ip?: string | null,
): Promise<CategoryView> {
  assertAdministrator(context)
  const details = parseInput(newCategory, input, INVALID)
  const parentId = details.parentId ?? null
  const tree = await lockCategoryTree(tx)
  const { depth, issue } = placement(tree, parentId)
  throwIfAny([
    issue,
    issue ? null : siblingNameIssue(tree, parentId, details.name),
    issue ? null : await parentHasProductsIssue(tx, parentId),
    details.slug === undefined ? null : slugIssue(tree, details.slug),
  ])
  const slug =
    details.slug ??
    firstFreeSlug(
      slugify(details.name, 'category'),
      tree.categories.map((category) => category.slug),
    )

  try {
    const [row] = await tx
      .insert(categories)
      .values({ ...details, parentId, depth, slug })
      .returning()
    const view = toView(row!)
    await recordAuditEntry(tx, {
      ...administratorActor(context),
      action: 'category.create',
      entityType: 'category',
      entityId: view.id,
      after: auditable(view),
      ip,
    })
    return view
  } catch (error) {
    throw explainUniqueViolation(error)
  }
}

/**
 * Changes a category. A new parentId moves it with everything below it,
 * unless that would put it inside itself or make the tree too deep.
 * Administrators only.
 */
export async function updateCategory(
  tx: Transaction,
  context: RequestContext,
  categoryId: string,
  input: unknown,
  ip?: string | null,
): Promise<CategoryView> {
  assertAdministrator(context)
  const changes = parseInput(categoryUpdate, input, INVALID)
  if (Object.keys(changes).length === 0) {
    throw new ValidationError('There is nothing to change')
  }
  if (!isUuid(categoryId)) {
    throw new NotFoundError('There is no category with that id')
  }
  const tree = await lockCategoryTree(tx)
  const current = tree.byId(categoryId)
  if (!current) throw new NotFoundError('There is no category with that id')

  const parentId =
    changes.parentId === undefined ? current.parentId : changes.parentId
  const moving = parentId !== current.parentId
  let depth = current.depth
  if (moving) {
    if (parentId !== null && tree.subtreeIds(categoryId).includes(parentId)) {
      throwIfAny([
        'parentId cannot be the category itself or one of its subcategories',
      ])
    }
    const target = placement(tree, parentId)
    throwIfAny([
      target.issue,
      target.issue ? null : await parentHasProductsIssue(tx, parentId),
    ])
    if (target.depth + tree.levelsBelow(categoryId) > MAX_CATEGORY_DEPTH) {
      throwIfAny([
        `parentId is too deep for this category and its subcategories; categories go at most ${MAX_CATEGORY_DEPTH + 1} levels deep`,
      ])
    }
    depth = target.depth
  }
  throwIfAny([
    moving || changes.name !== undefined
      ? siblingNameIssue(
          tree,
          parentId,
          changes.name ?? current.name,
          categoryId,
        )
      : null,
    changes.slug === undefined
      ? null
      : slugIssue(tree, changes.slug, categoryId),
  ])

  try {
    const [row] = await tx
      .update(categories)
      .set({ ...changes, depth })
      .where(eq(categories.id, categoryId))
      .returning()
    const below = tree.subtreeIds(categoryId).slice(1)
    if (depth !== current.depth && below.length > 0) {
      await tx
        .update(categories)
        .set({ depth: sql`${categories.depth} + ${depth - current.depth}` })
        .where(inArray(categories.id, below))
    }
    // Products' search text holds the category names from the top down.
    if (
      moving ||
      (changes.name !== undefined && changes.name !== current.name)
    ) {
      await refreshProducts(
        tx,
        inArray(products.categoryId, tree.subtreeIds(categoryId)),
      )
    }
    const touched = new Set([
      ...Object.keys(changes),
      ...(moving ? ['depth'] : []),
    ])
    const only = (view: CategoryView) =>
      Object.fromEntries(
        Object.entries(auditable(view)).filter(([key]) => touched.has(key)),
      )
    const view = toView(row!)
    await recordAuditEntry(tx, {
      ...administratorActor(context),
      action: 'category.update',
      entityType: 'category',
      entityId: categoryId,
      before: only(current),
      after: only(view),
      ip,
    })
    return view
  } catch (error) {
    throw explainUniqueViolation(error)
  }
}

const IN_USE =
  'Products are listed in this category; deactivate it instead of deleting it'

/**
 * Deletes a category that has no subcategories and no products, to remove a
 * mistake. Administrators only.
 */
export async function deleteCategory(
  tx: Transaction,
  context: RequestContext,
  categoryId: string,
  ip?: string | null,
): Promise<void> {
  assertAdministrator(context)
  if (!isUuid(categoryId)) {
    throw new NotFoundError('There is no category with that id')
  }
  const tree = await lockCategoryTree(tx)
  const current = tree.byId(categoryId)
  if (!current) throw new NotFoundError('There is no category with that id')
  if (tree.childrenOf(categoryId).length > 0) {
    throw new ConflictError(
      'This category has subcategories; move or delete them first, or deactivate it',
    )
  }
  // Products are part of the catalogue module, so this module reads them.
  const [used] = await tx
    .select({ id: products.id })
    .from(products)
    .where(eq(products.categoryId, categoryId))
    .limit(1)
  if (used) throw new ConflictError(IN_USE)

  try {
    await tx.delete(categories).where(eq(categories.id, categoryId))
  } catch (error) {
    // A product listed in it after the check above.
    if (foreignKeyViolation(error)) throw new ConflictError(IN_USE)
    throw error
  }
  await recordAuditEntry(tx, {
    ...administratorActor(context),
    action: 'category.delete',
    entityType: 'category',
    entityId: categoryId,
    before: auditable(current),
    ip,
  })
}
