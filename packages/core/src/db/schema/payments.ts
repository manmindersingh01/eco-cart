import { sql } from 'drizzle-orm'
import {
  bigserial,
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { users } from './auth.ts'
import {
  createdAt,
  paise,
  timestamptz,
  updatedAt,
  uuidPrimaryKey,
} from './columns.ts'
import { orders, returnRequests } from './orders.ts'
import {
  fullAccess,
  isOrderBuyer,
  webAll,
  webInsert,
  webSelect,
  webUpdate,
  workerPolicy,
} from './rls.ts'

/** One payment attempt for an order (design doc 5.8). */
export const payments = pgTable(
  'payments',
  {
    id: uuidPrimaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    provider: text('provider').notNull(),
    providerOrderId: text('provider_order_id').unique(),
    providerPaymentId: text('provider_payment_id').unique(),
    amountPaise: paise('amount_paise').notNull(),
    currency: text('currency').notNull().default('INR'),
    status: text('status').notNull().default('created'),
    // Whatever Razorpay reports (upi, card, emi, ...), so it is not limited
    // to a fixed list that a new payment method would break.
    method: text('method'),
    failureReason: text('failure_reason'),
    raw: jsonb('raw'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('payments_order_id_idx').on(t.orderId),
    check('payments_provider_check', sql`provider in ('razorpay', 'cod')`),
    check(
      'payments_status_check',
      sql`status in ('created', 'captured', 'failed', 'refunded', 'partially_refunded')`,
    ),
    check('payments_amount_paise_check', sql`amount_paise > 0`),
    check('payments_currency_check', sql`currency = 'INR'`),
    webSelect(sql`${fullAccess} or ${isOrderBuyer('payments.order_id')}`),
    webInsert(fullAccess),
    webUpdate(fullAccess),
    workerPolicy(),
  ],
).enableRLS()

/**
 * Every webhook delivery. The unique (provider, event_id) makes processing
 * idempotent: a replay inserts nothing (design doc 5.8). received_at is the
 * row's creation time.
 */
export const paymentEvents = pgTable(
  'payment_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    provider: text('provider').notNull(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    signatureValid: boolean('signature_valid').notNull(),
    receivedAt: timestamptz('received_at').notNull().defaultNow(),
    processedAt: timestamptz('processed_at'),
    error: text('error'),
  },
  (t) => [
    unique('payment_events_provider_event_id_key').on(t.provider, t.eventId),
    check('payment_events_provider_check', sql`provider in ('razorpay')`),
    webAll(fullAccess),
    workerPolicy(),
  ],
).enableRLS()

/**
 * A refund the administrator issued in the Razorpay dashboard or by bank
 * transfer, recorded here (design doc 6.5).
 */
export const refunds = pgTable(
  'refunds',
  {
    id: uuidPrimaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    paymentId: uuid('payment_id').references(() => payments.id),
    returnRequestId: uuid('return_request_id').references(
      (): AnyPgColumn => returnRequests.id,
    ),
    amountPaise: paise('amount_paise').notNull(),
    // Unique, so recording the same Razorpay refund twice is impossible.
    providerRefundId: text('provider_refund_id').unique(),
    method: text('method').notNull(),
    note: text('note'),
    recordedBy: uuid('recorded_by')
      .notNull()
      .references(() => users.id),
    recordedAt: timestamptz('recorded_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index('refunds_order_id_idx').on(t.orderId),
    check('refunds_amount_paise_check', sql`amount_paise > 0`),
    check('refunds_method_check', sql`method in ('gateway', 'bank_transfer')`),
    webSelect(sql`${fullAccess} or ${isOrderBuyer('refunds.order_id')}`),
    webInsert(fullAccess),
    workerPolicy(),
  ],
).enableRLS()
