import { sql } from 'drizzle-orm'
import {
  check,
  index,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { users } from './auth.ts'
import { products } from './catalogue.ts'
import { createdAt, updatedAt, uuidPrimaryKey } from './columns.ts'
import { orderItems } from './orders.ts'
import {
  currentUserId,
  fullAccess,
  webDelete,
  webInsert,
  webSelect,
  webUpdate,
  workerPolicy,
} from './rls.ts'

/** One review per buyer per product (design doc 5.10). */
export const reviews = pgTable(
  'reviews',
  {
    id: uuidPrimaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    // Set when the review comes from a verified purchase.
    orderItemId: uuid('order_item_id').references(() => orderItems.id),
    rating: smallint('rating').notNull(),
    title: text('title'),
    body: text('body'),
    status: text('status').notNull().default('published'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('reviews_product_id_user_id_key').on(t.productId, t.userId),
    index('reviews_product_id_status_created_at_idx').on(
      t.productId,
      t.status,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    check('reviews_rating_check', sql`rating between 1 and 5`),
    check('reviews_status_check', sql`status in ('published', 'hidden')`),
    webSelect(
      sql`status = 'published' or user_id = ${currentUserId} or ${fullAccess}`,
    ),
    webInsert(sql`user_id = ${currentUserId} or ${fullAccess}`),
    webUpdate(sql`user_id = ${currentUserId} or ${fullAccess}`),
    webDelete(sql`user_id = ${currentUserId} or ${fullAccess}`),
    workerPolicy(),
  ],
).enableRLS()
