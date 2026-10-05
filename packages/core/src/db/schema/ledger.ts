import { sql } from 'drizzle-orm'
import {
  bigserial,
  check,
  index,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core'
import { users } from './auth.ts'
import { createdAt, paise } from './columns.ts'
import { orderItems, orders, returnRequests } from './orders.ts'
import {
  currentSellerId,
  fullAccess,
  webInsert,
  webSelect,
  workerPolicy,
} from './rls.ts'
import { sellers } from './sellers.ts'

/**
 * Append-only seller money ledger; a seller's balance is the sum of their
 * entries (design doc 5.9). Mistakes are fixed with an `adjustment` entry.
 * A trigger rejects UPDATE and DELETE for every database user.
 */
export const sellerLedgerEntries = pgTable(
  'seller_ledger_entries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => sellers.id),
    orderId: uuid('order_id').references(() => orders.id),
    orderItemId: uuid('order_item_id').references(() => orderItems.id),
    returnRequestId: uuid('return_request_id').references(
      () => returnRequests.id,
    ),
    entryType: text('entry_type').notNull(),
    // Signed: money owed to the seller is positive, money taken back negative.
    amountPaise: paise('amount_paise').notNull(),
    description: text('description').notNull(),
    // Bank transfer reference for payouts.
    reference: text('reference'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('seller_ledger_entries_seller_id_created_at_idx').on(
      t.sellerId,
      t.createdAt,
      t.id,
    ),
    check(
      'seller_ledger_entries_entry_type_check',
      sql`entry_type in ('sale', 'commission', 'refund_reversal', 'commission_reversal', 'payout', 'adjustment')`,
    ),
    check(
      'seller_ledger_entries_sign_check',
      sql`case entry_type
        when 'sale' then amount_paise > 0
        when 'commission_reversal' then amount_paise > 0
        when 'commission' then amount_paise < 0
        when 'refund_reversal' then amount_paise < 0
        when 'payout' then amount_paise < 0
        else amount_paise <> 0
      end`,
    ),
    webSelect(sql`seller_id = ${currentSellerId} or ${fullAccess}`),
    webInsert(fullAccess),
    workerPolicy(),
  ],
).enableRLS()
