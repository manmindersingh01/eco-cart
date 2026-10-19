import { randomBytes } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import { cartItems, carts } from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import {
  createTestCategory,
  createTestProduct,
  createTestSeller,
  createTestUser,
  saveTestSettings,
} from '../../testing/fixtures.ts'
import { holdRows } from '../../testing/locks.ts'
import { removeStaleGuestCarts } from './jobs.ts'
import { addCartItem, removeCartItem, setCartItemQuantity } from './service.ts'

/*
 * The nightly clean-up of guest carts. Other test files use carts at the
 * same time, so the job runs as if it were early 2001, against carts last
 * changed in 2000: it can never reach a cart another test is using.
 */

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'cart-jobs-test')
  pools.push(pool)
  return createDatabase(pool)
}
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))
const web = connect(requireEnv('DATABASE_URL'))
const worker = connect(requireEnv('WORKER_DATABASE_URL'))
const photos = { publicUrl: (key: string) => `https://cdn.test/${key}` }

const now = new Date('2001-03-01T00:00:00Z')
const daysBefore = (days: number) =>
  new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

let variantId: string

beforeAll(async () => {
  await saveTestSettings(owner)
  const [{ seller }, category] = await Promise.all([
    createTestSeller(owner),
    createTestCategory(owner),
  ])
  const { variant } = await createTestProduct(owner, {
    sellerId: seller.id,
    categoryId: category.id,
  })
  variantId = variant.id
})

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()))
})

const newToken = () => randomBytes(32).toString('base64url')

/** A cart last changed at `updatedAt`, holding one item. */
async function cartChangedAt(
  updatedAt: Date,
  owner_: { userId?: string } = {},
): Promise<string> {
  const [cart] = await owner
    .insert(carts)
    .values({
      ...(owner_.userId
        ? { userId: owner_.userId }
        : { guestToken: newToken() }),
      createdAt: updatedAt,
      updatedAt,
    })
    .returning({ id: carts.id })
  await owner.insert(cartItems).values({
    cartId: cart!.id,
    variantId,
    quantity: 1,
    createdAt: updatedAt,
    updatedAt,
  })
  return cart!.id
}

const remaining = async (ids: string[]) =>
  (
    await owner
      .select({ id: carts.id })
      .from(carts)
      .where(inArray(carts.id, ids))
  ).map(({ id }) => id)

describe('the guest cart clean-up', () => {
  test('removes guest carts unchanged for more than 30 days, with their items, and keeps the rest', async () => {
    const stale = await cartChangedAt(daysBefore(32))
    // Unchanged for 30 days and a half: its cookie may still be on its way out.
    const lastDay = await cartChangedAt(daysBefore(30.5))
    const recent = await cartChangedAt(daysBefore(2))
    const buyer = await createTestUser(owner)
    const buyersCart = await cartChangedAt(daysBefore(400), {
      userId: buyer.id,
    })

    expect(await removeStaleGuestCarts(worker, now)).toBe(1)
    expect(
      (await remaining([stale, lastDay, recent, buyersCart])).toSorted(),
    ).toEqual([lastDay, recent, buyersCart].toSorted())
    expect(
      await owner.select().from(cartItems).where(eq(cartItems.cartId, stale)),
    ).toEqual([])
  })

  test('works through many carts a batch at a time', async () => {
    const changedAt = daysBefore(60)
    const tokens = Array.from({ length: 1201 }, newToken)
    const inserted = await owner
      .insert(carts)
      .values(
        tokens.map((guestToken) => ({
          guestToken,
          createdAt: changedAt,
          updatedAt: changedAt,
        })),
      )
      .returning({ id: carts.id })

    expect(await removeStaleGuestCarts(worker, now)).toBe(1201)
    expect(await remaining(inserted.map(({ id }) => id))).toEqual([])
  })

  test('skips a cart that a request is changing right now', async () => {
    const busy = await cartChangedAt(daysBefore(45))
    const held = await holdRows(owner, carts, carts.id, [busy])
    try {
      expect(await removeStaleGuestCarts(worker, now)).toBe(0)
    } finally {
      held.release()
      await held.finished
    }
    expect(await removeStaleGuestCarts(worker, now)).toBe(1)
    expect(await remaining([busy])).toEqual([])
  })
})

describe('a change to a guest cart', () => {
  test('moves the time the clean-up goes by, also when it only removes an item', async () => {
    const guest: RequestContext = { role: 'anonymous', guestToken: newToken() }
    const changedAt = async () => {
      const [cart] = await owner
        .select({ updatedAt: carts.updatedAt })
        .from(carts)
        .where(eq(carts.guestToken, guest.guestToken!))
      return cart!.updatedAt.getTime()
    }

    await withContext(web, guest, (tx) =>
      addCartItem(tx, guest, photos, { variantId, quantity: 1 }),
    )
    const added = await changedAt()
    await withContext(web, guest, (tx) =>
      setCartItemQuantity(tx, guest, photos, variantId, { quantity: 2 }),
    )
    const changed = await changedAt()
    expect(changed).toBeGreaterThan(added)
    await withContext(web, guest, (tx) =>
      removeCartItem(tx, guest, photos, variantId),
    )
    expect(await changedAt()).toBeGreaterThan(changed)
  })
})
