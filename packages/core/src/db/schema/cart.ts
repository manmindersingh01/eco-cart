import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { users } from './auth.ts'
import { productVariants } from './catalogue.ts'
import {
  createdAt,
  paise,
  timestamptz,
  updatedAt,
  uuidPrimaryKey,
} from './columns.ts'
import {
  currentGuestToken,
  currentUserId,
  fullAccess,
  webAll,
  workerPolicy,
} from './rls.ts'

/**
 * A logged-in buyer's cart, or a guest's cart found by the cookie token and
 * merged into the account on login (design doc 5.6). Carts store no prices.
 */
export const carts = pgTable(
  'carts',
  {
    id: uuidPrimaryKey(),
    userId: uuid('user_id')
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    guestToken: text('guest_token').unique(),
    couponCode: text('coupon_code'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [
    check(
      'carts_owner_check',
      sql`user_id is not null or guest_token is not null`,
    ),
    webAll(
      sql`user_id = ${currentUserId} or (user_id is null and guest_token = ${currentGuestToken}) or ${fullAccess}`,
    ),
    workerPolicy(),
  ],
).enableRLS()

export const cartItems = pgTable(
  'cart_items',
  {
    id: uuidPrimaryKey(),
    cartId: uuid('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id),
    quantity: integer('quantity').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('cart_items_cart_id_variant_id_key').on(t.cartId, t.variantId),
    check('cart_items_quantity_check', sql`quantity between 1 and 10`),
    // Visible exactly when its cart is visible under the carts policy.
    webAll(sql`exists (select 1 from carts c where c.id = cart_items.cart_id)`),
    workerPolicy(),
  ],
).enableRLS()

/**
 * Platform coupons, managed by administrators. Per-user usage is counted from
 * orders, so there is no usage table (design doc 5.6).
 */
export const coupons = pgTable(
  'coupons',
  {
    id: uuidPrimaryKey(),
    code: text('code').notNull().unique(),
    description: text('description').notNull().default(''),
    discountType: text('discount_type').notNull(),
    // Basis points for percent coupons, paise for fixed coupons.
    discountValue: integer('discount_value').notNull(),
    minOrderPaise: paise('min_order_paise').notNull().default(0),
    maxDiscountPaise: paise('max_discount_paise'),
    usageLimit: integer('usage_limit'),
    perUserLimit: integer('per_user_limit'),
    usedCount: integer('used_count').notNull().default(0),
    startsAt: timestamptz('starts_at').notNull().defaultNow(),
    endsAt: timestamptz('ends_at'),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [
    check('coupons_code_check', sql`code = upper(code) and code <> ''`),
    check(
      'coupons_discount_type_check',
      sql`discount_type in ('percent', 'fixed')`,
    ),
    check(
      'coupons_discount_value_check',
      sql`discount_value > 0 and (discount_type <> 'percent' or discount_value <= 10000)`,
    ),
    check('coupons_min_order_paise_check', sql`min_order_paise >= 0`),
    check('coupons_max_discount_paise_check', sql`max_discount_paise > 0`),
    check('coupons_usage_limit_check', sql`usage_limit > 0`),
    check('coupons_per_user_limit_check', sql`per_user_limit > 0`),
    // The last line of defence against over-use, behind the conditional
    // increment in checkout.
    check(
      'coupons_used_count_check',
      sql`used_count >= 0 and (usage_limit is null or used_count <= usage_limit)`,
    ),
    check('coupons_dates_check', sql`ends_at > starts_at`),
  ],
)
