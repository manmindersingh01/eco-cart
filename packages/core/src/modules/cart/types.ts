import { z } from 'zod'
import { idOf, strictObject, wholeNumber } from '../../lib/validation.ts'

/** The most of one variant a cart line can hold (`cart_items` checks it too). */
export const MAX_LINE_QUANTITY = 10

/** Different items one cart can hold, so a cart stays quick to price. */
export const MAX_CART_LINES = 50

const quantity = wholeNumber(1, MAX_LINE_QUANTITY)

/** What the buyer sends to add an item. */
export const newCartItem = strictObject({
  variantId: idOf('a product variant'),
  /**
   * How many more to add. Left out, the product's minimum order quantity,
   * which is 1 for most products.
   */
  quantity: quantity.optional(),
})

/** What the buyer sends to change how many of an item they want. */
export const cartItemUpdate = strictObject({ quantity })

/** What the buyer sends to use a coupon. */
export const couponEntry = strictObject({
  code: z
    .string()
    .trim()
    .min(1, 'must not be empty')
    .max(40, 'must be at most 40 characters')
    .transform((code) => code.toUpperCase()),
})

export interface CartLine {
  variantId: string
  productId: string
  productSlug: string
  title: string
  sku: string
  /** For example { Size: 'M' }. */
  options: Record<string, string>
  sellerName: string
  /** The thumbnail photo, or null when the product has none yet. */
  imageUrl: string | null
  unitPricePaise: number
  unitMrpPaise: number
  quantity: number
  lineTotalPaise: number
  /** The fewest this line may hold. */
  minQuantity: number
  /** The most this line can hold now: the stock, at most 10. */
  maxQuantity: number
  /** Why the line cannot be bought as it is, for example "Only 3 left". */
  problem: string | null
}

export interface CartCoupon {
  code: string
  description: string
  discountPaise: number
  /** Why the coupon does not apply right now, or null when it does. */
  problem: string | null
}

export interface CartView {
  lines: CartLine[]
  coupon: CartCoupon | null
  /** Every unit in the cart, for the cart badge. */
  itemCount: number
  /** The lines without a problem, which are what checkout would buy. */
  subtotalPaise: number
  discountPaise: number
  deliveryPaise: number
  totalPaise: number
  /** At least one line, and no problem with any line or the coupon. */
  canCheckOut: boolean
  /**
   * Things the buyer should be told once, for example that an item was
   * removed because it is no longer for sale.
   */
  notices: string[]
}

const DISCOUNT_TYPES = ['percent', 'fixed'] as const
export type DiscountType = (typeof DISCOUNT_TYPES)[number]
export const isDiscountType = (value: string): value is DiscountType =>
  (DISCOUNT_TYPES as readonly string[]).includes(value)

const dateTime = z.iso
  .datetime({
    offset: true,
    error: 'must be a date and time, like 2026-10-20T00:00:00+05:30',
  })
  .transform((value) => new Date(value))

/** Up to ₹10,00,000, the same ceiling as a variant's price. */
const amount = wholeNumber(0, 100_000_000)
const positiveAmount = wholeNumber(1, 100_000_000)
const limit = wholeNumber(1, 10_000_000)

const couponFields = {
  description: z.string().trim().max(200, 'must be at most 200 characters'),
  discountType: z.enum(DISCOUNT_TYPES),
  /** Basis points for percent coupons (1000 is 10%), paise for fixed ones. */
  discountValue: wholeNumber(1, 100_000_000),
  minOrderPaise: amount,
  /** Only for percent coupons: the most one order can save. */
  maxDiscountPaise: positiveAmount.nullable(),
  /** How many orders may use the coupon in total. */
  usageLimit: limit.nullable(),
  /** How many orders one buyer may use it on. */
  perUserLimit: limit.nullable(),
  startsAt: dateTime,
  endsAt: dateTime.nullable(),
  isActive: z.boolean(),
}

/** What an administrator sends to create a coupon. */
export const newCoupon = strictObject({
  code: z
    .string()
    .trim()
    .transform((code) => code.toUpperCase())
    .pipe(
      z
        .string()
        .regex(
          /^[A-Z0-9]{3,20}$/,
          'must be 3 to 20 letters or digits, like DIWALI25',
        ),
    ),
  description: couponFields.description.default(''),
  discountType: couponFields.discountType,
  discountValue: couponFields.discountValue,
  minOrderPaise: couponFields.minOrderPaise.default(0),
  maxDiscountPaise: couponFields.maxDiscountPaise.default(null),
  usageLimit: couponFields.usageLimit.default(null),
  perUserLimit: couponFields.perUserLimit.default(null),
  /** Left out: from now. */
  startsAt: couponFields.startsAt.optional(),
  /** Left out or null: no end date. */
  endsAt: couponFields.endsAt.default(null),
  isActive: couponFields.isActive.default(true),
})
export type NewCoupon = z.input<typeof newCoupon>

/** What an administrator may change; the code stays as it was created. */
export const couponUpdate = strictObject({
  description: couponFields.description.optional(),
  discountType: couponFields.discountType.optional(),
  discountValue: couponFields.discountValue.optional(),
  minOrderPaise: couponFields.minOrderPaise.optional(),
  maxDiscountPaise: couponFields.maxDiscountPaise.optional(),
  usageLimit: couponFields.usageLimit.optional(),
  perUserLimit: couponFields.perUserLimit.optional(),
  startsAt: couponFields.startsAt.optional(),
  endsAt: couponFields.endsAt.optional(),
  isActive: couponFields.isActive.optional(),
})
export type CouponUpdate = z.input<typeof couponUpdate>

export interface CouponView {
  id: string
  code: string
  description: string
  discountType: DiscountType
  discountValue: number
  minOrderPaise: number
  maxDiscountPaise: number | null
  usageLimit: number | null
  perUserLimit: number | null
  /** Orders that have used it, not counting cancelled ones. */
  usedCount: number
  startsAt: Date
  endsAt: Date | null
  isActive: boolean
  createdBy: string
  createdAt: Date
  updatedAt: Date
}
