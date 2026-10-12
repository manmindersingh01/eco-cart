import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { Transaction } from '../../db/client.ts'
import type { RequestContext } from '../../db/context.ts'
import {
  addresses,
  type ShippingAddressSnapshot,
} from '../../db/schema/index.ts'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../errors.ts'
import { stateName } from '../../lib/states.ts'
import { isUuid, parseInput } from '../../lib/validation.ts'
import { addressUpdate, newAddress, type AddressView } from './types.ts'

/*
 * A buyer's saved delivery addresses (backend spec step 10, design doc 5.3).
 * Checkout copies one onto the order, so editing or deleting an address never
 * changes a past order.
 */

type AddressRow = typeof addresses.$inferSelect
type Buyer = Extract<RequestContext, { role: 'buyer' }>

/** Live addresses per buyer; deleted ones do not count. */
export const MAX_ADDRESSES = 20

const INVALID = 'Those address details are not valid'
const NOT_FOUND = 'There is no saved address with that id'

function assertBuyer(context: RequestContext): asserts context is Buyer {
  if (context.role !== 'buyer') {
    throw new ForbiddenError('Only buyers can save delivery addresses')
  }
}

function toView(row: AddressRow): AddressView {
  return {
    id: row.id,
    fullName: row.fullName,
    phone: row.phone,
    line1: row.line1,
    line2: row.line2,
    landmark: row.landmark,
    city: row.city,
    stateCode: row.stateCode,
    // The database allows any two digits; the service only ever saves known
    // codes, so the fallback is for a row written by hand.
    stateName: stateName(row.stateCode) ?? row.stateCode,
    pincode: row.pincode,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

const liveAddressesOf = (userId: string) =>
  and(eq(addresses.userId, userId), isNull(addresses.deletedAt))

/**
 * Makes changes to one buyer's addresses run one after the other until the
 * transaction ends. Row locks cannot do this: before the first address there
 * is no row to lock, and two first addresses would both become the default.
 */
export async function lockAddressBook(
  tx: Transaction,
  userId: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`addresses:${userId}`}, 0))`,
  )
}

/** One of the buyer's live addresses, or 404 for anything else. */
async function findLive(
  tx: Transaction,
  userId: string,
  addressId: string,
): Promise<AddressRow> {
  if (!isUuid(addressId)) throw new NotFoundError(NOT_FOUND)
  const [row] = await tx
    .select()
    .from(addresses)
    .where(and(eq(addresses.id, addressId), liveAddressesOf(userId)))
  if (!row) throw new NotFoundError(NOT_FOUND)
  return row
}

/** Clears the current default, so another address can take it. */
async function clearDefault(tx: Transaction, userId: string): Promise<void> {
  await tx
    .update(addresses)
    .set({ isDefault: false })
    .where(and(liveAddressesOf(userId), eq(addresses.isDefault, true)))
}

/** The buyer's live addresses, the default first and then the newest. */
export async function listAddresses(
  tx: Transaction,
  context: RequestContext,
): Promise<AddressView[]> {
  assertBuyer(context)
  const rows = await tx
    .select()
    .from(addresses)
    .where(liveAddressesOf(context.userId))
    .orderBy(
      desc(addresses.isDefault),
      desc(addresses.createdAt),
      desc(addresses.id),
    )
  return rows.map(toView)
}

/** One of the buyer's live addresses. */
export async function getAddress(
  tx: Transaction,
  context: RequestContext,
  addressId: string,
): Promise<AddressView> {
  assertBuyer(context)
  return toView(await findLive(tx, context.userId, addressId))
}

/** Saves a new address; the buyer's first one becomes the default. */
export async function addAddress(
  tx: Transaction,
  context: RequestContext,
  input: unknown,
): Promise<AddressView> {
  assertBuyer(context)
  const { isDefault, ...details } = parseInput(newAddress, input, INVALID)
  const { userId } = context
  await lockAddressBook(tx, userId)
  const [{ count } = { count: 0 }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(addresses)
    .where(liveAddressesOf(userId))
  if (count >= MAX_ADDRESSES) {
    throw new ConflictError(
      `You can save up to ${MAX_ADDRESSES} addresses; delete one first`,
    )
  }
  const makeDefault = count === 0 || isDefault === true
  if (makeDefault) await clearDefault(tx, userId)
  const [row] = await tx
    .insert(addresses)
    .values({ ...details, userId, isDefault: makeDefault })
    .returning()
  return toView(row!)
}

/** Changes an address, or makes it the default with `isDefault: true`. */
export async function updateAddress(
  tx: Transaction,
  context: RequestContext,
  addressId: string,
  input: unknown,
): Promise<AddressView> {
  assertBuyer(context)
  const changes = parseInput(addressUpdate, input, INVALID)
  if (Object.keys(changes).length === 0) {
    throw new ValidationError('There is nothing to change')
  }
  const { userId } = context
  await lockAddressBook(tx, userId)
  const current = await findLive(tx, userId, addressId)
  if (changes.isDefault && !current.isDefault) await clearDefault(tx, userId)
  const [row] = await tx
    .update(addresses)
    .set(changes)
    .where(eq(addresses.id, current.id))
    .returning()
  return toView(row!)
}

/**
 * Deletes an address (soft delete, design doc 5.1). If it was the default,
 * the newest remaining address takes over.
 */
export async function deleteAddress(
  tx: Transaction,
  context: RequestContext,
  addressId: string,
): Promise<void> {
  assertBuyer(context)
  const { userId } = context
  await lockAddressBook(tx, userId)
  const current = await findLive(tx, userId, addressId)
  await tx
    .update(addresses)
    .set({ deletedAt: sql`now()`, isDefault: false })
    .where(eq(addresses.id, current.id))
  if (!current.isDefault) return
  const [newest] = await tx
    .select({ id: addresses.id })
    .from(addresses)
    .where(liveAddressesOf(userId))
    .orderBy(desc(addresses.createdAt), desc(addresses.id))
    .limit(1)
  if (newest) {
    await tx
      .update(addresses)
      .set({ isDefault: true })
      .where(eq(addresses.id, newest.id))
  }
}

/**
 * The address checkout copies onto an order (step 12): one of `buyerId`'s
 * live addresses, or 404 for a deleted address or someone else's. It takes
 * the buyer's id rather than a request context because checkout runs as
 * `system`, which row-level security does not limit.
 */
export async function getShippingAddress(
  tx: Transaction,
  buyerId: string,
  addressId: string,
): Promise<ShippingAddressSnapshot> {
  const row = await findLive(tx, buyerId, addressId)
  return {
    fullName: row.fullName,
    phone: row.phone,
    line1: row.line1,
    line2: row.line2,
    landmark: row.landmark,
    city: row.city,
    stateCode: row.stateCode,
    pincode: row.pincode,
  }
}
