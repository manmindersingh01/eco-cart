import { and, asc, eq, ne, sql, type SQL } from 'drizzle-orm'
import type { Transaction } from '../../db/client.ts'
import type { RequestContext } from '../../db/context.ts'
import { brands, products } from '../../db/schema/index.ts'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../errors.ts'
import {
  afterTextCursor,
  encodeTextCursor,
  pageSize,
  toPage,
  type Page,
} from '../../lib/pagination.ts'
import { foreignKeyViolation, uniqueViolation } from '../../lib/postgres.ts'
import { firstFreeSlug, slugify } from '../../lib/slug.ts'
import { isUuid, parseInput } from '../../lib/validation.ts'
import { recordAuditEntry, type AuditEntry } from '../audit/service.ts'
import { refreshProducts } from './summary.ts'
import {
  brandUpdate,
  newBrand,
  type BrandListOptions,
  type BrandView,
  type PublicBrand,
} from './types.ts'

/*
 * Brands (backend spec step 5, design doc 5.5). Administrators keep the list;
 * sellers pick from it, and anyone can read the active brands.
 */

type BrandRow = typeof brands.$inferSelect
type Administrator = Extract<RequestContext, { role: 'admin' | 'system' }>

const INVALID = 'Those brand details are not valid'
const MAX_QUERY_LENGTH = 80

function toView(row: BrandRow): BrandView {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function assertAdministrator(
  context: RequestContext,
): asserts context is Administrator {
  if (context.role !== 'admin' && context.role !== 'system') {
    throw new ForbiddenError('Only administrators can manage brands')
  }
}

const administratorActor = (
  context: Administrator,
): Pick<AuditEntry, 'actorUserId' | 'actorRole'> => ({
  actorUserId: context.userId ?? null,
  actorRole: context.role,
})

function auditable(view: BrandView) {
  const { createdAt: _created, updatedAt: _updated, ...details } = view
  return details
}

/** The A to Z order of brands, which the unique name index covers. */
const sortKey = sql<string>`lower(${brands.name})`

/** `text` with LIKE's wildcards made literal. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&')

async function brandPage(
  tx: Transaction,
  options: BrandListOptions,
  activeOnly: boolean,
): Promise<Page<BrandView>> {
  const limit = pageSize(options.limit)
  const q = options.q?.trim() ?? ''
  if (q.length > MAX_QUERY_LENGTH) {
    throw new ValidationError(
      `q must be at most ${MAX_QUERY_LENGTH} characters`,
    )
  }
  const conditions: SQL[] = [
    ...(activeOnly ? [eq(brands.isActive, true)] : []),
    ...(q ? [sql`${brands.name} ilike ${`%${escapeLike(q)}%`}`] : []),
    ...(options.cursor ? [afterTextCursor(options.cursor, sortKey)] : []),
  ]
  const rows = await tx
    .select({ brand: brands, sortKey })
    .from(brands)
    .where(and(...conditions))
    .orderBy(asc(sortKey))
    .limit(limit + 1)
  return toPage(
    rows,
    limit,
    (row) => toView(row.brand),
    (row) => encodeTextCursor(row.sortKey),
  )
}

/** Active brands A to Z, a page at a time. For anyone. */
export async function listBrands(
  tx: Transaction,
  options: BrandListOptions = {},
): Promise<Page<PublicBrand>> {
  const page = await brandPage(tx, options, true)
  return {
    ...page,
    items: page.items.map(({ id, name, slug }) => ({ id, name, slug })),
  }
}

/** Every brand A to Z, active or not. Administrators only. */
export async function listAllBrands(
  tx: Transaction,
  context: RequestContext,
  options: BrandListOptions = {},
): Promise<Page<BrandView>> {
  assertAdministrator(context)
  return brandPage(tx, options, false)
}

async function nameIssue(
  tx: Transaction,
  name: string,
  exceptId?: string,
): Promise<string | null> {
  const [other] = await tx
    .select({ id: brands.id })
    .from(brands)
    .where(
      and(
        sql`${sortKey} = lower(${name})`,
        exceptId ? ne(brands.id, exceptId) : undefined,
      ),
    )
  return other ? 'name is already used by another brand' : null
}

async function slugIssue(
  tx: Transaction,
  slug: string,
  exceptId?: string,
): Promise<string | null> {
  const [other] = await tx
    .select({ id: brands.id })
    .from(brands)
    .where(
      and(
        eq(brands.slug, slug),
        exceptId ? ne(brands.id, exceptId) : undefined,
      ),
    )
  return other ? 'slug is already used by another brand' : null
}

async function freeSlug(tx: Transaction, name: string): Promise<string> {
  const base = slugify(name, 'brand')
  // A slug holds only a-z, 0-9, and hyphens, so it is safe inside the pattern.
  const taken = await tx
    .select({ slug: brands.slug })
    .from(brands)
    .where(sql`${brands.slug} ~ ${`^${base}(-[0-9]+)?$`}`)
  return firstFreeSlug(
    base,
    taken.map((row) => row.slug),
  )
}

function throwIfAny(issues: (string | null)[]): void {
  const found = issues.filter((issue) => issue !== null)
  if (found.length > 0) throw new ValidationError(INVALID, found)
}

/** Turns a unique-constraint race into the message the pre-check gives. */
function explainUniqueViolation(error: unknown): unknown {
  const constraint = uniqueViolation(error)
  if (constraint === 'brands_name_unique') {
    return new ValidationError(INVALID, [
      'name is already used by another brand',
    ])
  }
  if (constraint === 'brands_slug_unique') {
    return new ValidationError(INVALID, [
      'slug is already used by another brand',
    ])
  }
  return error
}

/** Creates a brand. Administrators only. */
export async function createBrand(
  tx: Transaction,
  context: RequestContext,
  input: unknown,
  ip?: string | null,
): Promise<BrandView> {
  assertAdministrator(context)
  const details = parseInput(newBrand, input, INVALID)
  throwIfAny([
    await nameIssue(tx, details.name),
    details.slug === undefined ? null : await slugIssue(tx, details.slug),
  ])
  try {
    const [row] = await tx
      .insert(brands)
      .values({
        ...details,
        slug: details.slug ?? (await freeSlug(tx, details.name)),
      })
      .returning()
    const view = toView(row!)
    await recordAuditEntry(tx, {
      ...administratorActor(context),
      action: 'brand.create',
      entityType: 'brand',
      entityId: view.id,
      after: auditable(view),
      ip,
    })
    return view
  } catch (error) {
    throw explainUniqueViolation(error)
  }
}

/** Locks one brand for a change, or 404. */
async function lockBrand(tx: Transaction, id: string): Promise<BrandRow> {
  if (!isUuid(id)) throw new NotFoundError('There is no brand with that id')
  const [row] = await tx
    .select()
    .from(brands)
    .where(eq(brands.id, id))
    .for('update')
  if (!row) throw new NotFoundError('There is no brand with that id')
  return row
}

/** Changes a brand's name, slug, or whether it is active. Administrators only. */
export async function updateBrand(
  tx: Transaction,
  context: RequestContext,
  brandId: string,
  input: unknown,
  ip?: string | null,
): Promise<BrandView> {
  assertAdministrator(context)
  const changes = parseInput(brandUpdate, input, INVALID)
  if (Object.keys(changes).length === 0) {
    throw new ValidationError('There is nothing to change')
  }
  const current = toView(await lockBrand(tx, brandId))
  throwIfAny([
    changes.name === undefined
      ? null
      : await nameIssue(tx, changes.name, brandId),
    changes.slug === undefined
      ? null
      : await slugIssue(tx, changes.slug, brandId),
  ])
  try {
    const [row] = await tx
      .update(brands)
      .set(changes)
      .where(eq(brands.id, brandId))
      .returning()
    // Products' search text holds the brand name.
    if (changes.name !== undefined && changes.name !== current.name) {
      await refreshProducts(tx, eq(products.brandId, brandId))
    }
    const view = toView(row!)
    const only = (brand: BrandView) =>
      Object.fromEntries(
        Object.entries(auditable(brand)).filter(([key]) => key in changes),
      )
    await recordAuditEntry(tx, {
      ...administratorActor(context),
      action: 'brand.update',
      entityType: 'brand',
      entityId: brandId,
      before: only(current),
      after: only(view),
      ip,
    })
    return view
  } catch (error) {
    throw explainUniqueViolation(error)
  }
}

const IN_USE = 'Products use this brand; deactivate it instead of deleting it'

/** Deletes a brand that no product uses. Administrators only. */
export async function deleteBrand(
  tx: Transaction,
  context: RequestContext,
  brandId: string,
  ip?: string | null,
): Promise<void> {
  assertAdministrator(context)
  const current = toView(await lockBrand(tx, brandId))
  // Products are part of the catalogue module, so this module reads them.
  const [used] = await tx
    .select({ id: products.id })
    .from(products)
    .where(eq(products.brandId, brandId))
    .limit(1)
  if (used) throw new ConflictError(IN_USE)
  try {
    await tx.delete(brands).where(eq(brands.id, brandId))
  } catch (error) {
    // A product used it after the check above.
    if (foreignKeyViolation(error)) throw new ConflictError(IN_USE)
    throw error
  }
  await recordAuditEntry(tx, {
    ...administratorActor(context),
    action: 'brand.delete',
    entityType: 'brand',
    entityId: brandId,
    before: auditable(current),
    ip,
  })
}
