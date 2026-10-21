import { randomBytes, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import {
  cartItems,
  carts,
  orders,
  products,
  productVariants,
  sellers,
} from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  TooManyRequestsError,
  ValidationError,
} from '../../errors.ts'
import { validationIssues } from '../../testing/errors.ts'
import {
  createTestCategory,
  createTestCoupon,
  createTestOrderWithLines,
  createTestPhoto,
  createTestProduct,
  createTestSeller,
  createTestUser,
  saveTestSettings,
} from '../../testing/fixtures.ts'
import { holdRows, sessionsWaitingOn, waitUntil } from '../../testing/locks.ts'
import {
  addCartItem,
  applyCoupon,
  COUPON_ATTEMPTS_PER_HOUR,
  getCart,
  removeCartItem,
  removeCoupon,
  setCartItemQuantity,
} from './service.ts'
import { MAX_LINE_QUANTITY } from './types.ts'

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'cart-test')
  pools.push(pool)
  return createDatabase(pool)
}
const web = connect(requireEnv('DATABASE_URL'))
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))

const photos = { publicUrl: (key: string) => `https://cdn.test/${key}` }

let sellerId: string
let categoryId: string
let adminId: string

beforeAll(async () => {
  await saveTestSettings(owner)
  const [{ seller }, category, admin] = await Promise.all([
    createTestSeller(owner),
    createTestCategory(owner),
    createTestUser(owner, 'admin'),
  ])
  sellerId = seller.id
  categoryId = category.id
  adminId = admin.id
})

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()))
})

type Guest = Extract<RequestContext, { role: 'anonymous' }>
type Buyer = Extract<RequestContext, { role: 'buyer' }>

const newGuest = (): Guest => ({
  role: 'anonymous',
  guestToken: randomBytes(32).toString('base64url'),
})
async function newBuyer(guestToken?: string): Promise<Buyer> {
  const user = await createTestUser(owner)
  return { role: 'buyer', userId: user.id, guestToken }
}

/** An approved item at `pricePaise` with `stock` left. */
async function newItem(
  options: { pricePaise?: number; stock?: number; seller?: string } = {},
) {
  const { product, variant } = await createTestProduct(owner, {
    sellerId: options.seller ?? sellerId,
    categoryId,
  })
  const pricePaise = options.pricePaise ?? 50_000
  await owner
    .update(productVariants)
    .set({
      pricePaise,
      mrpPaise: Math.max(pricePaise, 60_000),
      stock: options.stock ?? 5,
    })
    .where(eq(productVariants.id, variant.id))
  return { product, variant, title: product.title }
}

const view = (context: RequestContext) =>
  withContext(web, context, (tx) => getCart(tx, context, photos))
const add = (context: RequestContext, input: unknown) =>
  withContext(web, context, (tx) => addCartItem(tx, context, photos, input))
const set = (context: RequestContext, variantId: string, quantity: unknown) =>
  withContext(web, context, (tx) =>
    setCartItemQuantity(tx, context, photos, variantId, { quantity }),
  )
const remove = (context: RequestContext, variantId: string) =>
  withContext(web, context, (tx) =>
    removeCartItem(tx, context, photos, variantId),
  )
const useCoupon = (context: RequestContext, code: string, ip?: string) =>
  applyCoupon(web, context, photos, { code }, ip ?? randomUUID())
const dropCoupon = (context: RequestContext) =>
  withContext(web, context, (tx) => removeCoupon(tx, context, photos))

describe('a guest cart', () => {
  test('is empty for a new visitor, without needing any settings', async () => {
    expect(await view({ role: 'anonymous' })).toEqual({
      lines: [],
      coupon: null,
      itemCount: 0,
      subtotalPaise: 0,
      discountPaise: 0,
      deliveryPaise: 0,
      totalPaise: 0,
      canCheckOut: false,
      notices: [],
    })
  })

  test('holds what the guest adds, priced fresh every time', async () => {
    const guest = newGuest()
    const { product, variant, title } = await newItem()
    const photo = await createTestPhoto(owner, product.id)
    await owner
      .update(products)
      .set({ primaryImageId: photo.id })
      .where(eq(products.id, product.id))

    const cart = await add(guest, { variantId: variant.id, quantity: 2 })
    expect(cart).toEqual({
      lines: [
        {
          variantId: variant.id,
          productId: product.id,
          productSlug: product.slug,
          title,
          sku: variant.sku,
          options: {},
          sellerName: expect.any(String),
          imageUrl: `https://cdn.test/${photo.storageKey}/thumb.webp`,
          unitPricePaise: 50_000,
          unitMrpPaise: 60_000,
          quantity: 2,
          lineTotalPaise: 100_000,
          minQuantity: 1,
          maxQuantity: 5,
          problem: null,
        },
      ],
      coupon: null,
      itemCount: 2,
      subtotalPaise: 100_000,
      discountPaise: 0,
      deliveryPaise: 0,
      totalPaise: 100_000,
      canCheckOut: true,
      notices: [],
    })

    await owner
      .update(productVariants)
      .set({ pricePaise: 45_000 })
      .where(eq(productVariants.id, variant.id))
    expect(await view(guest)).toMatchObject({
      lines: [{ unitPricePaise: 45_000, lineTotalPaise: 90_000 }],
      totalPaise: 90_000,
    })
  })

  test('charges delivery below the free-delivery threshold', async () => {
    const guest = newGuest()
    const { variant } = await newItem({ pricePaise: 20_000 })
    expect(await add(guest, { variantId: variant.id })).toMatchObject({
      subtotalPaise: 20_000,
      deliveryPaise: 4_900,
      totalPaise: 24_900,
    })
  })

  test('adds to a line already in the cart, and changes or removes it', async () => {
    const guest = newGuest()
    const { variant } = await newItem()
    await add(guest, { variantId: variant.id })
    const more = await add(guest, { variantId: variant.id, quantity: 2 })
    expect(more.lines.map((line) => line.quantity)).toEqual([3])
    expect((await set(guest, variant.id, 5)).lines[0]?.quantity).toBe(5)
    expect((await remove(guest, variant.id)).lines).toEqual([])
    await expect(remove(guest, variant.id)).rejects.toThrow(
      new NotFoundError('That item is not in your cart'),
    )
    await expect(set(guest, 'not-an-id', 1)).rejects.toThrow(NotFoundError)
  })

  test('cannot see another guest cart', async () => {
    const asha = newGuest()
    const { variant } = await newItem()
    await add(asha, { variantId: variant.id })
    expect((await view(newGuest())).lines).toEqual([])
    const rows = await withContext(web, newGuest(), (tx) =>
      tx.select().from(carts).where(eq(carts.guestToken, asha.guestToken!)),
    )
    expect(rows).toEqual([])
  })
})

describe('what a line may hold', () => {
  test('refuses more than the stock, in words', async () => {
    const guest = newGuest()
    const { variant, title } = await newItem({ stock: 5 })
    await expect(
      add(guest, { variantId: variant.id, quantity: 6 }),
    ).rejects.toThrow(new ConflictError(`Only 5 of ${title} are left`))
    await add(guest, { variantId: variant.id, quantity: 4 })
    await expect(
      add(guest, { variantId: variant.id, quantity: 2 }),
    ).rejects.toThrow(ConflictError)
    await expect(set(guest, variant.id, 6)).rejects.toThrow(
      new ConflictError(`Only 5 of ${title} are left`),
    )
  })

  test('refuses an item that is out of stock', async () => {
    const { variant, title } = await newItem({ stock: 0 })
    await expect(add(newGuest(), { variantId: variant.id })).rejects.toThrow(
      new ConflictError(`${title} is out of stock`),
    )
  })

  test(`holds at most ${MAX_LINE_QUANTITY} of one item`, async () => {
    const guest = newGuest()
    const { variant, title } = await newItem({ stock: 5_000 })
    expect(
      await validationIssues(
        add(guest, { variantId: variant.id, quantity: MAX_LINE_QUANTITY + 1 }),
      ),
    ).toEqual([`quantity must be at most ${MAX_LINE_QUANTITY}`])
    await add(guest, { variantId: variant.id, quantity: MAX_LINE_QUANTITY - 1 })
    await expect(
      add(guest, { variantId: variant.id, quantity: 2 }),
    ).rejects.toThrow(
      new ValidationError(
        `You can buy at most ${MAX_LINE_QUANTITY} of ${title} in one order`,
      ),
    )
  })

  test("keeps every line at or above the product's minimum buying quantity", async () => {
    const guest = newGuest()
    const { product, variant, title } = await newItem({ stock: 20 })
    await owner
      .update(products)
      .set({ minOrderQuantity: 5 })
      .where(eq(products.id, product.id))
    await expect(
      add(guest, { variantId: variant.id, quantity: 3 }),
    ).rejects.toThrow(
      new ValidationError(`${title} must be bought in at least 5`),
    )
    // Left out, the quantity is the minimum.
    const cart = await add(guest, { variantId: variant.id })
    expect(cart.lines[0]).toMatchObject({ quantity: 5, minQuantity: 5 })
    await expect(set(guest, variant.id, 4)).rejects.toThrow(
      new ValidationError(`${title} must be bought in at least 5`),
    )
    // The seller raises the minimum after the line was added.
    await owner
      .update(products)
      .set({ minOrderQuantity: 6 })
      .where(eq(products.id, product.id))
    expect(await view(guest)).toMatchObject({
      lines: [{ problem: `${title} must be bought in at least 6` }],
      canCheckOut: false,
    })
    expect((await set(guest, variant.id, 6)).canCheckOut).toBe(true)
  })

  test('B06 minimum quantity applies separately to each variant, without requiring multiples', async () => {
    const guest = newGuest()
    const { product, variant } = await newItem({ stock: 30 })
    await owner
      .update(products)
      .set({ minOrderQuantity: 10 })
      .where(eq(products.id, product.id))
    const [other] = await owner
      .insert(productVariants)
      .values({
        productId: product.id,
        sku: `MIN-${randomUUID()}`,
        pricePaise: 50_000,
        mrpPaise: 60_000,
        stock: 30,
      })
      .returning()
    expect(
      (await add(guest, { variantId: variant.id, quantity: 11 })).lines[0]
        ?.quantity,
    ).toBe(11)
    await expect(
      add(guest, { variantId: other!.id, quantity: 5 }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect((await view(guest)).lines).toHaveLength(1)
    expect(
      (await add(guest, { variantId: other!.id, quantity: 10 })).lines,
    ).toHaveLength(2)
  })

  test('refuses what is not for sale', async () => {
    const guest = newGuest()
    const { variant, title } = await newItem()
    await owner
      .update(productVariants)
      .set({ isActive: false })
      .where(eq(productVariants.id, variant.id))
    await expect(add(guest, { variantId: variant.id })).rejects.toThrow(
      new ConflictError(`${title} is not for sale right now`),
    )

    // A draft is hidden from buyers altogether.
    const { variant: draft } = await createTestProduct(owner, {
      sellerId,
      categoryId,
      status: 'draft',
    })
    for (const variantId of [draft.id, randomUUID()]) {
      await expect(add(guest, { variantId })).rejects.toThrow(
        new NotFoundError('There is no product variant with that id'),
      )
    }
    expect(await validationIssues(add(guest, { variantId: 'x' }))).toEqual([
      'variantId must be a product variant id',
    ])
  })

  test('shows a line that no longer fits the stock, and stops checkout', async () => {
    const guest = newGuest()
    const { variant, title } = await newItem({ stock: 5 })
    const { variant: other } = await newItem({ stock: 5 })
    await add(guest, { variantId: variant.id, quantity: 3 })
    await add(guest, { variantId: other.id, quantity: 1 })
    await owner
      .update(productVariants)
      .set({ stock: 2 })
      .where(eq(productVariants.id, variant.id))
    const cart = await view(guest)
    expect(cart.lines[0]).toMatchObject({
      quantity: 3,
      maxQuantity: 2,
      problem: `Only 2 of ${title} are left`,
    })
    expect(cart).toMatchObject({
      subtotalPaise: 50_000,
      itemCount: 4,
      canCheckOut: false,
    })

    await owner
      .update(productVariants)
      .set({ stock: 0 })
      .where(eq(productVariants.id, variant.id))
    expect((await view(guest)).lines[0]?.problem).toBe(
      `${title} is out of stock`,
    )
  })

  test('removes lines that are no longer for sale, and says so once', async () => {
    const guest = newGuest()
    const { seller: shortLived } = await createTestSeller(owner)
    const { variant: suspended } = await newItem({ seller: shortLived.id })
    const { variant: switchedOff, title } = await newItem()
    const { variant: kept } = await newItem()
    for (const variant of [suspended, switchedOff, kept]) {
      await add(guest, { variantId: variant.id })
    }
    await owner
      .update(sellers)
      .set({ status: 'suspended' })
      .where(eq(sellers.id, shortLived.id))
    await owner
      .update(productVariants)
      .set({ isActive: false })
      .where(eq(productVariants.id, switchedOff.id))

    const cart = await view(guest)
    expect(cart.lines.map((line) => line.variantId)).toEqual([kept.id])
    expect(cart.notices).toEqual([
      'An item in your cart is no longer for sale and was removed',
      `${title} is no longer for sale and was removed from your cart`,
    ])
    expect((await view(guest)).notices).toEqual([])
  })
})

describe('signing in', () => {
  test('takes over the guest cart when the buyer has none', async () => {
    const guest = newGuest()
    const { variant } = await newItem()
    await add(guest, { variantId: variant.id, quantity: 2 })
    const buyer = await newBuyer(guest.guestToken)

    const cart = await view(buyer)
    expect(cart.lines.map((line) => line.quantity)).toEqual([2])
    const [row] = await owner
      .select()
      .from(carts)
      .where(eq(carts.userId, buyer.userId))
    expect(row).toMatchObject({ guestToken: null })
    // The cart follows the account, not the old cookie.
    expect((await view(guest)).lines).toEqual([])
    expect(
      (await view({ role: 'buyer', userId: buyer.userId })).lines,
    ).toHaveLength(1)
  })

  test("adds the guest's items and coupon to the buyer's own cart", async () => {
    const shared = await newItem({ stock: 50 })
    const extra = await newItem()
    const coupon = await createTestCoupon(owner, adminId)
    const buyer = await newBuyer()
    await add(buyer, { variantId: shared.variant.id, quantity: 2 })

    const guest = newGuest()
    await add(guest, { variantId: shared.variant.id, quantity: 9 })
    await add(guest, { variantId: extra.variant.id, quantity: 1 })
    await useCoupon(guest, coupon.code)

    const cart = await view({ ...buyer, guestToken: guest.guestToken })
    expect(cart.lines.map((line) => [line.variantId, line.quantity])).toEqual([
      [shared.variant.id, 11],
      [extra.variant.id, 1],
    ])
    expect(cart.coupon?.code).toBe(coupon.code)
    const guestCarts = await owner
      .select()
      .from(carts)
      .where(eq(carts.guestToken, guest.guestToken!))
    expect(guestCarts).toEqual([])
  })
})

describe('who has a cart', () => {
  test.each<[string, RequestContext]>([
    [
      'a seller',
      { role: 'seller', userId: randomUUID(), sellerId: randomUUID() },
    ],
    ['an administrator', { role: 'admin', userId: randomUUID() }],
    ['the system', { role: 'system' }],
  ])('not %s', async (_who, context) => {
    await expect(view(context)).rejects.toThrow(ForbiddenError)
    await expect(add(context, { variantId: randomUUID() })).rejects.toThrow(
      ForbiddenError,
    )
    await expect(useCoupon(context, 'ANY')).rejects.toThrow(ForbiddenError)
  })

  test("a buyer cannot reach another buyer's cart", async () => {
    const { variant } = await newItem()
    const asha = await newBuyer()
    await add(asha, { variantId: variant.id })
    const ravi = await newBuyer()
    expect((await view(ravi)).lines).toEqual([])
    const rows = await withContext(web, ravi, (tx) =>
      tx.select().from(cartItems),
    )
    expect(rows).toEqual([])
  })
})

describe('coupons in the cart', () => {
  test('takes the discount off and keeps delivery free above the threshold', async () => {
    const guest = newGuest()
    const { variant } = await newItem()
    const coupon = await createTestCoupon(owner, adminId)
    await add(guest, { variantId: variant.id, quantity: 2 })
    const cart = await useCoupon(guest, coupon.code.toLowerCase())
    expect(cart).toMatchObject({
      coupon: {
        code: coupon.code,
        description: '10% off',
        discountPaise: 10_000,
        problem: null,
      },
      subtotalPaise: 100_000,
      discountPaise: 10_000,
      deliveryPaise: 0,
      totalPaise: 90_000,
      canCheckOut: true,
    })
    expect((await dropCoupon(guest)).coupon).toBeNull()
  })

  test('refuses a code that does not exist or does not apply', async () => {
    const guest = newGuest()
    const { variant } = await newItem({ pricePaise: 20_000 })
    await add(guest, { variantId: variant.id })
    await expect(useCoupon(guest, 'NOSUCHCODE')).rejects.toThrow(
      new NotFoundError('There is no coupon with that code'),
    )
    const coupon = await createTestCoupon(owner, adminId)
    await expect(useCoupon(guest, coupon.code)).rejects.toThrow(
      new ConflictError(
        'This coupon needs items worth at least ₹500; add ₹300 more',
      ),
    )
    expect((await view(guest)).coupon).toBeNull()
  })

  test('shows why a coupon stopped applying, and stops checkout', async () => {
    const guest = newGuest()
    const { variant } = await newItem({ pricePaise: 29_950 })
    const coupon = await createTestCoupon(owner, adminId)
    await add(guest, { variantId: variant.id, quantity: 2 })
    expect((await useCoupon(guest, coupon.code)).discountPaise).toBe(5_990)
    const cart = await set(guest, variant.id, 1)
    expect(cart).toMatchObject({
      coupon: {
        discountPaise: 0,
        problem:
          'This coupon needs items worth at least ₹500; add ₹200.50 more',
      },
      discountPaise: 0,
      deliveryPaise: 4_900,
      totalPaise: 34_850,
      canCheckOut: false,
    })
  })

  test('refuses a coupon the buyer has used as often as allowed', async () => {
    const { product, variant } = await newItem()
    const coupon = await createTestCoupon(owner, adminId, { perUserLimit: 1 })
    const buyer = await newBuyer()
    const { order } = await createTestOrderWithLines(owner, {
      buyerId: buyer.userId,
      lines: [{ sellerId, productId: product.id, variantId: variant.id }],
    })
    await owner
      .update(orders)
      .set({ couponId: coupon.id, couponCode: coupon.code })
      .where(eq(orders.id, order.id))
    await add(buyer, { variantId: variant.id, quantity: 2 })
    await expect(useCoupon(buyer, coupon.code)).rejects.toThrow(
      new ConflictError('You have already used this coupon'),
    )
  })

  test(`allows ${COUPON_ATTEMPTS_PER_HOUR} codes an hour from one visitor`, async () => {
    const guest = newGuest()
    const ip = `198.51.100.${Math.floor(Math.random() * 250) + 1}-${randomUUID()}`
    for (let attempt = 0; attempt < COUPON_ATTEMPTS_PER_HOUR; attempt += 1) {
      await expect(useCoupon(guest, `GUESS${attempt}`, ip)).rejects.toThrow(
        NotFoundError,
      )
    }
    await expect(useCoupon(guest, 'GUESSAGAIN', ip)).rejects.toThrow(
      TooManyRequestsError,
    )
  })
})

describe('changes that arrive at the same moment', () => {
  test('two adds to one cart both count', async () => {
    const guest = newGuest()
    const { variant } = await newItem({ stock: 10 })
    await add(guest, { variantId: variant.id })
    const [cart] = await owner
      .select()
      .from(carts)
      .where(eq(carts.guestToken, guest.guestToken!))
    const hold = await holdRows(owner, carts, carts.id, [cart!.id])
    const adds = [1, 2].map(() => add(guest, { variantId: variant.id }))
    await waitUntil(
      async () => (await sessionsWaitingOn(owner, hold.pid)) === 2,
    )
    hold.release()
    await hold.finished
    await Promise.all(adds)
    expect((await view(guest)).lines[0]?.quantity).toBe(3)
  })

  test("a guest's first two adds make one cart", async () => {
    const guest = newGuest()
    const { variant } = await newItem({ stock: 10 })
    const { variant: other } = await newItem({ stock: 10 })
    await Promise.all([
      add(guest, { variantId: variant.id }),
      add(guest, { variantId: other.id }),
    ])
    expect((await view(guest)).lines).toHaveLength(2)
  })
})
