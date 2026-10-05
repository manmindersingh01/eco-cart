import { sql } from 'drizzle-orm'
import { char, check, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { users } from './auth.ts'
import { createdAt, timestamptz, updatedAt, uuidPrimaryKey } from './columns.ts'
import {
  currentSellerId,
  currentUserId,
  fullAccess,
  webInsert,
  webSelect,
  webUpdate,
  workerPolicy,
} from './rls.ts'

/** A seller business, owned by one seller account (design doc 5.4). */
export const sellers = pgTable(
  'sellers',
  {
    id: uuidPrimaryKey(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .unique()
      .references(() => users.id),
    slug: text('slug').notNull().unique(),
    displayName: text('display_name').notNull(),
    legalName: text('legal_name').notNull(),
    gstin: text('gstin'),
    pan: text('pan'),
    line1: text('line1').notNull(),
    city: text('city').notNull(),
    stateCode: char('state_code', { length: 2 }).notNull(),
    pincode: char('pincode', { length: 6 }).notNull(),
    supportEmail: text('support_email').notNull(),
    supportPhone: text('support_phone').notNull(),
    // Overrides the platform default commission when set.
    commissionBps: integer('commission_bps'),
    // Invoice numbers must be unique across the platform, so prefixes are too.
    invoicePrefix: text('invoice_prefix').notNull().unique(),
    invoiceSeq: integer('invoice_seq').notNull().default(0),
    invoiceSeqFy: text('invoice_seq_fy'),
    status: text('status').notNull().default('pending'),
    approvedAt: timestamptz('approved_at'),
    suspendedReason: text('suspended_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [
    check(
      'sellers_status_check',
      sql`status in ('pending', 'approved', 'suspended')`,
    ),
    check(
      'sellers_gstin_check',
      sql`gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`,
    ),
    check('sellers_pan_check', sql`pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'`),
    check('sellers_state_code_check', sql`state_code ~ '^[0-9]{2}$'`),
    check('sellers_pincode_check', sql`pincode ~ '^[1-9][0-9]{5}$'`),
    check(
      'sellers_support_phone_check',
      sql`support_phone ~ '^\\+[1-9][0-9]{7,14}$'`,
    ),
    check(
      'sellers_commission_bps_check',
      sql`commission_bps between 0 and 10000`,
    ),
    check(
      'sellers_invoice_prefix_check',
      sql`invoice_prefix ~ '^[A-Z0-9]{1,6}$'`,
    ),
    check('sellers_invoice_seq_check', sql`invoice_seq >= 0`),
    check(
      'sellers_invoice_seq_fy_check',
      sql`invoice_seq_fy ~ '^[0-9]{4}-[0-9]{2}$'`,
    ),
    webSelect(
      sql`status = 'approved' or owner_user_id = ${currentUserId} or id = ${currentSellerId} or ${fullAccess}`,
    ),
    webInsert(fullAccess),
    webUpdate(sql`id = ${currentSellerId} or ${fullAccess}`),
    workerPolicy(),
  ],
).enableRLS()
