import { desc, eq } from 'drizzle-orm'
import type { Transaction } from '../../db/client.ts'
import type { RequestContext } from '../../db/context.ts'
import { coupons } from '../../db/schema/index.ts'
import { ForbiddenError, NotFoundError, ValidationError } from '../../errors.ts'
import { formatRupees } from '../../lib/money.ts'
import {
  afterCursor,
  exactTime,
  newestFirstCursor,
  pageSize,
  toPage,
  type Page,
} from '../../lib/pagination.ts'
import { uniqueViolation } from '../../lib/postgres.ts'
import { isUuid, parseInput } from '../../lib/validation.ts'
import { recordAuditEntry } from '../audit/service.ts'
import { countCouponUses } from '../orders/queries.ts'
import type { CouponTerms } from './pricing.ts'
import {
  couponUpdate,
  isDiscountType,
  newCoupon,
  type CouponView,
} from './types.ts'

/*
 * Platform coupons (backend spec step 11, design doc 5.6). Administrators
 * create and change them; buyers enter a code in the cart, and checkout
 * (step 12) uses one with a conditional increment of `used_count`.
 */

export type CouponRow = typeof coupons.$inferSelect
type Administrator = Extract<RequestContext, { role: 'admin' }>

const INVALID = 'Those coupon details are not valid'
const NOT_FOUND = 'There is no coupon with that id'
const CODE_TAKEN = 'code is already used by another coupon'

function assertAdministrator(
  context: RequestContext,
): asserts context is Administrator {
  if (context.role !== 'admin') {
    throw new ForbiddenError('Only administrators can manage coupons')
  }
}

export function toCouponView(row: CouponRow): CouponView {
  if (!isDiscountType(row.discountType)) {
    throw new Error(
      `Coupon ${row.id} has an unknown discount type ${row.discountType}`,
    )
  }
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    discountType: row.discountType,
    discountValue: row.discountValue,
    minOrderPaise: row.minOrderPaise,
    maxDiscountPaise: row.maxDiscountPaise,
    usageLimit: row.usageLimit,
    perUserLimit: row.perUserLimit,
    usedCount: row.usedCount,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    isActive: row.isActive,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** The terms pricing needs, from a coupon row. */
export const couponTerms = (row: CouponRow): CouponTerms => ({
  discountType: toCouponView(row).discountType,
  discountValue: row.discountValue,
  maxDiscountPaise: row.maxDiscountPaise,
})

type CouponRules = Pick<
  CouponView,
  | 'discountType'
  | 'discountValue'
  | 'minOrderPaise'
  | 'maxDiscountPaise'
  | 'usageLimit'
  | 'usedCount'
  | 'startsAt'
  | 'endsAt'
>

/** Rules that span fields, checked on the coupon as it would be saved. */
function ruleIssues(coupon: CouponRules): string[] {
  const issues: string[] = []
  if (coupon.discountType === 'percent' && coupon.discountValue > 10_000) {
    issues.push(
      'discountValue must be at most 10000 (100%) for a percent coupon',
    )
  }
  if (coupon.discountType === 'fixed') {
    if (coupon.maxDiscountPaise !== null) {
      issues.push('maxDiscountPaise is only for percent coupons')
    }
    // Otherwise a ₹100 coupon on a ₹100 order would make the items free.
    if (coupon.minOrderPaise <= coupon.discountValue) {
      issues.push(
        'minOrderPaise must be more than the discount of a fixed coupon, so no order is free',
      )
    }
  }
  if (coupon.endsAt !== null && coupon.endsAt <= coupon.startsAt) {
    issues.push('endsAt must be after startsAt')
  }
  if (coupon.usageLimit !== null && coupon.usageLimit < coupon.usedCount) {
    issues.push(
      `usageLimit cannot be below the ${coupon.usedCount} times the coupon has been used`,
    )
  }
  return issues
}

function throwIfAny(issues: string[]): void {
  if (issues.length > 0) throw new ValidationError(INVALID, issues)
}

function auditable(view: CouponView) {
  const {
    createdAt: _created,
    updatedAt: _updated,
    usedCount: _used,
    ...terms
  } = view
  return terms
}

/** Creates a coupon. Administrators only. */
export async function createCoupon(
  tx: Transaction,
  context: RequestContext,
  input: unknown,
  ip?: string | null,
): Promise<CouponView> {
  assertAdministrator(context)
  const details = parseInput(newCoupon, input, INVALID)
  const startsAt = details.startsAt ?? new Date()
  const issues = ruleIssues({ ...details, startsAt, usedCount: 0 })
  if (details.endsAt !== null && details.endsAt <= new Date()) {
    issues.push('endsAt must be in the future')
  }
  if (await findCouponByCode(tx, details.code)) issues.push(CODE_TAKEN)
  throwIfAny(issues)
  try {
    const [row] = await tx
      .insert(coupons)
      .values({
        ...details,
        startsAt,
        createdBy: context.userId,
      })
      .returning()
    const view = toCouponView(row!)
    await recordAuditEntry(tx, {
      actorUserId: context.userId,
      actorRole: 'admin',
      action: 'coupon.create',
      entityType: 'coupon',
      entityId: view.id,
      after: auditable(view),
      ip,
    })
    return view
  } catch (error) {
    if (uniqueViolation(error) === 'coupons_code_unique') {
      throw new ValidationError(INVALID, [CODE_TAKEN])
    }
    throw error
  }
}

/** Locks one coupon for a change, or 404. */
async function lockCoupon(tx: Transaction, id: string): Promise<CouponRow> {
  if (!isUuid(id)) throw new NotFoundError(NOT_FOUND)
  const [row] = await tx
    .select()
    .from(coupons)
    .where(eq(coupons.id, id))
    .for('update')
  if (!row) throw new NotFoundError(NOT_FOUND)
  return row
}

/**
 * Changes a coupon's description, discount, limits, dates, or whether it is
 * active; deactivating is `isActive: false`. Administrators only. Orders keep
 * their own copy of the code and discount, so a change never alters a past
 * order.
 */
export async function updateCoupon(
  tx: Transaction,
  context: RequestContext,
  couponId: string,
  input: unknown,
  ip?: string | null,
): Promise<CouponView> {
  assertAdministrator(context)
  if (typeof input === 'object' && input !== null && 'code' in input) {
    throw new ValidationError(INVALID, [
      'code cannot be changed; create a new coupon instead',
    ])
  }
  const changes = parseInput(couponUpdate, input, INVALID)
  if (Object.keys(changes).length === 0) {
    throw new ValidationError('There is nothing to change')
  }
  const current = toCouponView(await lockCoupon(tx, couponId))
  throwIfAny(ruleIssues({ ...current, ...changes }))
  const [row] = await tx
    .update(coupons)
    .set(changes)
    .where(eq(coupons.id, couponId))
    .returning()
  const view = toCouponView(row!)
  const only = (coupon: CouponView) =>
    Object.fromEntries(
      Object.entries(auditable(coupon)).filter(([key]) => key in changes),
    )
  await recordAuditEntry(tx, {
    actorUserId: context.userId,
    actorRole: 'admin',
    action: 'coupon.update',
    entityType: 'coupon',
    entityId: couponId,
    before: only(current),
    after: only(view),
    ip,
  })
  return view
}

/** One coupon. Administrators only. */
export async function getCoupon(
  tx: Transaction,
  context: RequestContext,
  couponId: string,
): Promise<CouponView> {
  assertAdministrator(context)
  if (!isUuid(couponId)) throw new NotFoundError(NOT_FOUND)
  const [row] = await tx.select().from(coupons).where(eq(coupons.id, couponId))
  if (!row) throw new NotFoundError(NOT_FOUND)
  return toCouponView(row)
}

/** Every coupon, newest first, a page at a time. Administrators only. */
export async function listCoupons(
  tx: Transaction,
  context: RequestContext,
  options: { cursor?: string; limit?: number } = {},
): Promise<Page<CouponView>> {
  assertAdministrator(context)
  const limit = pageSize(options.limit)
  const rows = await tx
    .select({ coupon: coupons, cursorTime: exactTime(coupons.createdAt) })
    .from(coupons)
    .where(
      options.cursor
        ? afterCursor(options.cursor, coupons.createdAt, coupons.id)
        : undefined,
    )
    .orderBy(desc(coupons.createdAt), desc(coupons.id))
    .limit(limit + 1)
  return toPage(
    rows,
    limit,
    (row) => toCouponView(row.coupon),
    (row) =>
      newestFirstCursor({ cursorTime: row.cursorTime, id: row.coupon.id }),
  )
}

/** The coupon with `code`, ignoring capital letters, or null. */
export async function findCouponByCode(
  tx: Transaction,
  code: string,
): Promise<CouponRow | null> {
  const [row] = await tx
    .select()
    .from(coupons)
    .where(eq(coupons.code, code.trim().toUpperCase()))
  return row ?? null
}

const indianDate = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Kolkata',
})

/**
 * Why `coupon` cannot be used on an order of `subtotalPaise` (the items
 * before the discount) by `userId`, in words for the buyer, or null when it
 * can. A guest has no orders yet, so their per-buyer limit is checked once
 * they sign in, and again at checkout.
 */
export async function couponProblem(
  tx: Transaction,
  coupon: CouponRow,
  options: { subtotalPaise: number; userId?: string | undefined; now?: Date },
): Promise<string | null> {
  const now = options.now ?? new Date()
  if (!coupon.isActive) return 'This coupon is no longer active'
  if (now < coupon.startsAt) {
    return `This coupon can be used from ${indianDate.format(coupon.startsAt)}`
  }
  if (coupon.endsAt !== null && now >= coupon.endsAt) {
    return 'This coupon has expired'
  }
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
    return 'This coupon has been used up'
  }
  if (options.subtotalPaise < coupon.minOrderPaise) {
    return `This coupon needs items worth at least ${formatRupees(coupon.minOrderPaise)}; add ${formatRupees(coupon.minOrderPaise - options.subtotalPaise)} more`
  }
  if (coupon.perUserLimit !== null && options.userId) {
    const uses = await countCouponUses(tx, coupon.id, options.userId)
    if (uses >= coupon.perUserLimit) {
      return coupon.perUserLimit === 1
        ? 'You have already used this coupon'
        : `You have already used this coupon ${coupon.perUserLimit} times, the most allowed`
    }
  }
  return null
}
