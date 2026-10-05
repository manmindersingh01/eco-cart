import { sql } from 'drizzle-orm'
import {
  boolean,
  char,
  check,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { users } from './auth.ts'
import { createdAt, timestamptz, updatedAt, uuidPrimaryKey } from './columns.ts'
import { currentUserId, fullAccess, webAll, workerPolicy } from './rls.ts'

/** A buyer's saved delivery addresses (design doc 5.3). */
export const addresses = pgTable(
  'addresses',
  {
    id: uuidPrimaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    fullName: text('full_name').notNull(),
    phone: text('phone').notNull(),
    line1: text('line1').notNull(),
    line2: text('line2'),
    landmark: text('landmark'),
    city: text('city').notNull(),
    // Two-digit GST state code, compared with the seller's for CGST/SGST or IGST.
    stateCode: char('state_code', { length: 2 }).notNull(),
    pincode: char('pincode', { length: 6 }).notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    index('addresses_user_id_idx').on(t.userId),
    uniqueIndex('addresses_one_default_per_user_idx')
      .on(t.userId)
      .where(sql`is_default and deleted_at is null`),
    check('addresses_phone_check', sql`phone ~ '^\\+[1-9][0-9]{7,14}$'`),
    check('addresses_state_code_check', sql`state_code ~ '^[0-9]{2}$'`),
    check('addresses_pincode_check', sql`pincode ~ '^[1-9][0-9]{5}$'`),
    webAll(sql`user_id = ${currentUserId} or ${fullAccess}`),
    workerPolicy(),
  ],
).enableRLS()
