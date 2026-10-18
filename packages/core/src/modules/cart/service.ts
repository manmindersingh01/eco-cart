import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Database, Transaction } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { cartItems, carts } from '../../db/schema/index.ts'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  TooManyRequestsError,
  ValidationError,
} from '../../errors.ts'
import { imageSizeKey } from '../../lib/images.ts'
import { isUuid, parseInput } from '../../lib/validation.ts'
import type { PhotoAddresses } from '../catalogue/products.ts'
import {
  readPurchasableVariants,
  type PurchasableVariant,
} from '../catalogue/stock.ts'
import { consumeRateLimit, hashedRateLimitKey } from '../rate-limits/service.ts'
import { getSetting } from '../settings/service.ts'
import {
  couponProblem,
  couponTerms,
  findCouponByCode,
  type CouponRow,
} from './coupons.ts'
import { couponDiscount, deliveryCharge } from './pricing.ts'
import {
  cartItemUpdate,
  couponEntry,
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  newCartItem,
  type CartCoupon,
  type CartLine,
  type CartView,
} from './types.ts'

/*
 * The cart (backend spec step 11, design doc 5.6). A guest's cart is found by
 * the token in their cart cookie, and a signed-in buyer's by their account;
 * the first request after signing in moves the guest cart into the account.
 * Carts store no prices: every view reads price and stock fresh.
 */

type CartRow = typeof carts.$inferSelect
/** A guest (with or without a cart cookie yet) or a signed-in buyer. */
export type Shopper = Extract<RequestContext, { role: 'anonymous' | 'buyer' }>

/** Coupon codes one visitor may try in an hour, so codes cannot be guessed. */
export const COUPON_ATTEMPTS_PER_HOUR = 20

function assertShopper(context: RequestContext): asserts context is Shopper {
  if (context.role !== 'anonymous' && context.role !== 'buyer') {
    throw new ForbiddenError(
      'Only buyers have a cart; sellers and administrators shop with a separate buyer account',
    )
  }
}

/** Which cart belongs to the shopper, or null for a guest without a cookie. */
function ownCart(shopper: Shopper) {
  if (shopper.role === 'buyer') return eq(carts.userId, shopper.userId)
  if (!shopper.guestToken) return null
  return and(isNull(carts.userId), eq(carts.guestToken, shopper.guestToken))
}

async function findCart(
  tx: Transaction,
  shopper: Shopper,
): Promise<CartRow | null> {
  const which = ownCart(shopper)
  if (!which) return null
  const [row] = await tx.select().from(carts).where(which).for('update')
  return row ?? null
}

/**
 * The shopper's cart, created if needed, and locked until the transaction
 * ends, so two changes to one cart take turns.
 */
async function openCart(tx: Transaction, shopper: Shopper): Promise<CartRow> {
  if (shopper.role === 'anonymous' && !shopper.guestToken) {
    throw new Error('A guest needs a cart token before their cart is opened')
  }
  // Two first requests at once: one inserts and the other finds its row.
  await tx
    .insert(carts)
    .values(
      shopper.role === 'buyer'
        ? { userId: shopper.userId }
        : { guestToken: shopper.guestToken! },
    )
    .onConflictDoNothing()
  const cart = await findCart(tx, shopper)
  if (!cart) throw new Error('The cart just created could not be found')
  return cart
}

/**
 * Moves a guest's cart into the signed-in buyer's account: the whole cart if
 * they have none yet, otherwise each item added to theirs (at most 1000 of
 * one item; the view flags a line over the stock) and the guest's coupon if
 * they have none. Does nothing without a guest cart.
 */
async function adoptGuestCart(
  tx: Transaction,
  shopper: Shopper,
): Promise<void> {
  if (shopper.role !== 'buyer' || !shopper.guestToken) return
  const [guest] = await tx
    .select()
    .from(carts)
    .where(and(isNull(carts.userId), eq(carts.guestToken, shopper.guestToken)))
    .for('update')
  if (!guest) return
  const own = await findCart(tx, shopper)
  if (!own) {
    await tx
      .update(carts)
      .set({ userId: shopper.userId, guestToken: null })
      .where(eq(carts.id, guest.id))
    return
  }
  await tx.execute(sql`
    insert into cart_items (cart_id, variant_id, quantity)
    select ${own.id}, variant_id, quantity from cart_items
    where cart_id = ${guest.id}
    on conflict (cart_id, variant_id) do update
      set quantity = least(cart_items.quantity + excluded.quantity, ${MAX_LINE_QUANTITY})
  `)
  if (own.couponCode === null && guest.couponCode !== null) {
    await tx
      .update(carts)
      .set({ couponCode: guest.couponCode })
      .where(eq(carts.id, own.id))
  }
  await tx.delete(carts).where(eq(carts.id, guest.id))
}

/** "Bamboo Straws (Steel, Pack of 4)", as messages name an item. */
function itemName(variant: PurchasableVariant): string {
  const options = Object.values(variant.options)
  return options.length > 0
    ? `${variant.title} (${options.join(', ')})`
    : variant.title
}

/** Why `quantity` of `variant` cannot be bought right now, or null. */
function quantityProblem(
  variant: PurchasableVariant,
  quantity: number,
): string | null {
  if (variant.stock === 0) return `${itemName(variant)} is out of stock`
  if (quantity > variant.stock) {
    return variant.stock === 1
      ? `Only 1 of ${itemName(variant)} is left`
      : `Only ${variant.stock} of ${itemName(variant)} are left`
  }
  if (quantity < variant.minOrderQuantity) {
    return `${itemName(variant)} must be bought in at least ${variant.minOrderQuantity}`
  }
  return null
}

/** The variant a buyer asked for, or why it cannot be in a cart. */
async function variantForSale(
  tx: Transaction,
  variantId: string,
): Promise<PurchasableVariant> {
  const variant = (await readPurchasableVariants(tx, [variantId])).get(
    variantId,
  )
  if (!variant) {
    throw new NotFoundError('There is no product variant with that id')
  }
  if (!variant.forSale) {
    throw new ConflictError(`${itemName(variant)} is not for sale right now`)
  }
  return variant
}

/** Refuses a line quantity that cannot be bought, in words for the buyer. */
function checkQuantity(variant: PurchasableVariant, quantity: number): void {
  if (quantity > MAX_LINE_QUANTITY) {
    throw new ValidationError(
      `You can buy at most ${MAX_LINE_QUANTITY} of ${itemName(variant)} in one order`,
    )
  }
  const problem = quantityProblem(variant, quantity)
  if (problem === null) return
  if (quantity < variant.minOrderQuantity) throw new ValidationError(problem)
  throw new ConflictError(problem)
}

/**
 * The cart as the buyer sees it, priced fresh. Lines whose item is no longer
 * for sale (withdrawn, a size switched off, or the seller suspended) are
 * removed, with a notice, so a cart only ever holds what can be bought.
 */
async function viewCart(
  tx: Transaction,
  shopper: Shopper,
  cart: CartRow | null,
  photos: PhotoAddresses,
): Promise<CartView> {
  const items = cart
    ? await tx
        .select()
        .from(cartItems)
        .where(eq(cartItems.cartId, cart.id))
        .orderBy(asc(cartItems.createdAt), asc(cartItems.id))
    : []
  const variants = await readPurchasableVariants(
    tx,
    items.map((item) => item.variantId),
  )

  const notices: string[] = []
  const gone: string[] = []
  const lines: CartLine[] = []
  for (const item of items) {
    const variant = variants.get(item.variantId)
    if (!variant?.forSale) {
      gone.push(item.id)
      notices.push(
        variant
          ? `${itemName(variant)} is no longer for sale and was removed from your cart`
          : 'An item in your cart is no longer for sale and was removed',
      )
      continue
    }
    lines.push({
      variantId: variant.variantId,
      productId: variant.productId,
      productSlug: variant.productSlug,
      title: variant.title,
      sku: variant.sku,
      options: variant.options,
      sellerName: variant.sellerName,
      imageUrl: variant.imageKey
        ? photos.publicUrl(imageSizeKey(variant.imageKey, 'thumb'))
        : null,
      unitPricePaise: variant.pricePaise,
      unitMrpPaise: variant.mrpPaise,
      quantity: item.quantity,
      lineTotalPaise: variant.pricePaise * item.quantity,
      minQuantity: variant.minOrderQuantity,
      maxQuantity: Math.min(variant.stock, MAX_LINE_QUANTITY),
      problem: quantityProblem(variant, item.quantity),
    })
  }
  if (gone.length > 0) {
    await tx.delete(cartItems).where(inArray(cartItems.id, gone))
  }

  const subtotalPaise = lines
    .filter((line) => line.problem === null)
    .reduce((sum, line) => sum + line.lineTotalPaise, 0)
  const coupon = cart?.couponCode
    ? await priceCoupon(tx, shopper, cart.couponCode, subtotalPaise)
    : null
  const discountPaise = coupon?.discountPaise ?? 0
  const itemsPaise = subtotalPaise - discountPaise
  const deliveryPaise =
    itemsPaise > 0
      ? deliveryCharge(itemsPaise, {
          chargePaise: await getSetting(tx, 'delivery_charge_paise'),
          freeFromPaise: await getSetting(tx, 'free_delivery_threshold_paise'),
        })
      : 0
  return {
    lines,
    coupon,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotalPaise,
    discountPaise,
    deliveryPaise,
    totalPaise: itemsPaise + deliveryPaise,
    canCheckOut:
      lines.length > 0 &&
      lines.every((line) => line.problem === null) &&
      (coupon === null || coupon.problem === null),
    notices,
  }
}

async function priceCoupon(
  tx: Transaction,
  shopper: Shopper,
  code: string,
  subtotalPaise: number,
): Promise<CartCoupon> {
  const coupon = await findCouponByCode(tx, code)
  if (!coupon) {
    return {
      code,
      description: '',
      discountPaise: 0,
      problem: 'This coupon is no longer active',
    }
  }
  const problem = await usableProblem(tx, shopper, coupon, subtotalPaise)
  return {
    code: coupon.code,
    description: coupon.description,
    discountPaise: problem
      ? 0
      : couponDiscount(couponTerms(coupon), subtotalPaise),
    problem,
  }
}

const usableProblem = (
  tx: Transaction,
  shopper: Shopper,
  coupon: CouponRow,
  subtotalPaise: number,
) =>
  couponProblem(tx, coupon, {
    subtotalPaise,
    userId: shopper.role === 'buyer' ? shopper.userId : undefined,
  })

/** The shopper's cart, priced fresh. An empty cart for a new visitor. */
export async function getCart(
  tx: Transaction,
  context: RequestContext,
  photos: PhotoAddresses,
): Promise<CartView> {
  assertShopper(context)
  await adoptGuestCart(tx, context)
  return viewCart(tx, context, await findCart(tx, context), photos)
}

/**
 * Adds an item, or more of an item already in the cart. A guest's request
 * must carry the cart token their cookie will hold.
 */
export async function addCartItem(
  tx: Transaction,
  context: RequestContext,
  photos: PhotoAddresses,
  input: unknown,
): Promise<CartView> {
  assertShopper(context)
  const request = parseInput(newCartItem, input, 'That item cannot be added')
  await adoptGuestCart(tx, context)
  const cart = await openCart(tx, context)
  const variant = await variantForSale(tx, request.variantId)
  const [existing] = await tx
    .select()
    .from(cartItems)
    .where(
      and(
        eq(cartItems.cartId, cart.id),
        eq(cartItems.variantId, variant.variantId),
      ),
    )
  if (!existing) {
    const [{ lines } = { lines: 0 }] = await tx
      .select({ lines: sql<number>`count(*)::int` })
      .from(cartItems)
      .where(eq(cartItems.cartId, cart.id))
    if (lines >= MAX_CART_LINES) {
      throw new ConflictError(
        `Your cart can hold up to ${MAX_CART_LINES} different items`,
      )
    }
  }
  const quantity =
    (existing?.quantity ?? 0) + (request.quantity ?? variant.minOrderQuantity)
  checkQuantity(variant, quantity)
  if (existing) {
    await tx
      .update(cartItems)
      .set({ quantity })
      .where(eq(cartItems.id, existing.id))
  } else {
    await tx
      .insert(cartItems)
      .values({ cartId: cart.id, variantId: variant.variantId, quantity })
  }
  return viewCart(tx, context, cart, photos)
}

/** The line for `variantId` in the shopper's cart, or 404. */
async function cartLine(
  tx: Transaction,
  shopper: Shopper,
  variantId: string,
): Promise<{ cart: CartRow; itemId: string }> {
  const cart = await findCart(tx, shopper)
  const [item] =
    cart && isUuid(variantId)
      ? await tx
          .select({ id: cartItems.id })
          .from(cartItems)
          .where(
            and(
              eq(cartItems.cartId, cart.id),
              eq(cartItems.variantId, variantId),
            ),
          )
      : []
  if (!cart || !item) throw new NotFoundError('That item is not in your cart')
  return { cart, itemId: item.id }
}

/** Sets how many of an item the cart holds. */
export async function setCartItemQuantity(
  tx: Transaction,
  context: RequestContext,
  photos: PhotoAddresses,
  variantId: string,
  input: unknown,
): Promise<CartView> {
  assertShopper(context)
  const { quantity } = parseInput(
    cartItemUpdate,
    input,
    'That quantity is not valid',
  )
  await adoptGuestCart(tx, context)
  const { cart, itemId } = await cartLine(tx, context, variantId)
  checkQuantity(await variantForSale(tx, variantId), quantity)
  await tx.update(cartItems).set({ quantity }).where(eq(cartItems.id, itemId))
  return viewCart(tx, context, cart, photos)
}

/** Takes an item out of the cart. */
export async function removeCartItem(
  tx: Transaction,
  context: RequestContext,
  photos: PhotoAddresses,
  variantId: string,
): Promise<CartView> {
  assertShopper(context)
  await adoptGuestCart(tx, context)
  const { cart, itemId } = await cartLine(tx, context, variantId)
  await tx.delete(cartItems).where(eq(cartItems.id, itemId))
  return viewCart(tx, context, cart, photos)
}

/**
 * Uses a coupon on the cart, if it applies to the cart as it is now. Takes
 * the database because each attempt is counted in a transaction of its own:
 * a refused code rolls its own transaction back, and must still count.
 */
export async function applyCoupon(
  db: Database,
  context: RequestContext,
  photos: PhotoAddresses,
  input: unknown,
  ip?: string | null,
): Promise<CartView> {
  assertShopper(context)
  const { code } = parseInput(
    couponEntry,
    input,
    'That coupon code is not valid',
  )
  const visitor =
    ip ??
    (context.role === 'buyer' ? context.userId : (context.guestToken ?? ''))
  const attempts = await consumeRateLimit(db, {
    key: hashedRateLimitKey('coupon', visitor),
    limit: COUPON_ATTEMPTS_PER_HOUR,
    windowSeconds: 3600,
  })
  if (!attempts.allowed) {
    throw new TooManyRequestsError(
      'Too many coupon codes tried; please try again later',
      { resetAt: attempts.resetAt },
    )
  }
  return withContext(db, context, async (tx) => {
    await adoptGuestCart(tx, context)
    const coupon = await findCouponByCode(tx, code)
    if (!coupon) throw new NotFoundError('There is no coupon with that code')
    const cart = await openCart(tx, context)
    const before = await viewCart(tx, context, cart, photos)
    const problem = await usableProblem(
      tx,
      context,
      coupon,
      before.subtotalPaise,
    )
    if (problem) throw new ConflictError(problem)
    const [updated] = await tx
      .update(carts)
      .set({ couponCode: coupon.code })
      .where(eq(carts.id, cart.id))
      .returning()
    return viewCart(tx, context, updated!, photos)
  })
}

/** Takes the coupon off the cart. */
export async function removeCoupon(
  tx: Transaction,
  context: RequestContext,
  photos: PhotoAddresses,
): Promise<CartView> {
  assertShopper(context)
  await adoptGuestCart(tx, context)
  const cart = await findCart(tx, context)
  if (!cart) return viewCart(tx, context, null, photos)
  const [updated] = await tx
    .update(carts)
    .set({ couponCode: null })
    .where(eq(carts.id, cart.id))
    .returning()
  return viewCart(tx, context, updated!, photos)
}
