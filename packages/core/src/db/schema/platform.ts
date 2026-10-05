import { sql } from 'drizzle-orm'
import {
  bigserial,
  check,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core'
import { users } from './auth.ts'
import {
  actorRoleCheck,
  createdAt,
  timestamptz,
  updatedAt,
  uuidPrimaryKey,
} from './columns.ts'
import {
  currentUserId,
  fullAccess,
  webInsert,
  webSelect,
  workerPolicy,
} from './rls.ts'

/** Key-value platform settings, validated by the settings module (5.13). */
export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/** Terms, privacy, shipping, returns, refunds, and seller agreement pages. */
export const contentPages = pgTable(
  'content_pages',
  {
    id: uuidPrimaryKey(),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    bodyMarkdown: text('body_markdown').notNull().default(''),
    status: text('status').notNull().default('draft'),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    publishedAt: timestamptz('published_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [
    check('content_pages_slug_check', sql`slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check('content_pages_status_check', sql`status in ('draft', 'published')`),
  ],
)

/**
 * Emails are written here in the same transaction as the business change and
 * sent by the worker, so none is lost or sent for a change that was rolled
 * back (design doc 5.13).
 */
export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id'),
    toEmail: text('to_email').notNull(),
    template: text('template').notNull(),
    subject: text('subject').notNull(),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: text('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    providerMessageId: text('provider_message_id'),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    sentAt: timestamptz('sent_at'),
  },
  (t) => [
    index('email_outbox_status_created_at_idx').on(t.status, t.createdAt),
    check(
      'email_outbox_template_check',
      sql`template in ('otp', 'order_placed', 'payment_received', 'dispatched', 'cancelled', 'refund_recorded')`,
    ),
    check(
      'email_outbox_status_check',
      sql`status in ('queued', 'sent', 'failed')`,
    ),
    check('email_outbox_attempts_check', sql`attempts >= 0`),
    webSelect(fullAccess),
    // Any request may queue an email, including a login OTP before sign-in.
    webInsert(sql`true`),
    workerPolicy(),
  ],
).enableRLS()

/** Every administrator action (design doc 5.13). Append only. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorUserId: uuid('actor_user_id'),
    actorRole: text('actor_role').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: inet('ip'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_entity_type_entity_id_idx').on(t.entityType, t.entityId),
    index('audit_logs_actor_user_id_created_at_idx').on(
      t.actorUserId,
      t.createdAt,
    ),
    check('audit_logs_actor_role_check', actorRoleCheck()),
    webSelect(fullAccess),
    webInsert(sql`${fullAccess} or actor_user_id = ${currentUserId}`),
    workerPolicy(),
  ],
).enableRLS()

/**
 * Fixed-window counters for checkout, search, and AI endpoints, updated with
 * one upsert per request (design doc 8).
 */
export const rateLimits = pgTable(
  'rate_limits',
  {
    key: text('key').primaryKey(),
    windowStart: timestamptz('window_start').notNull(),
    count: integer('count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Lets a cleanup job delete expired windows without a full scan.
    index('rate_limits_window_start_idx').on(t.windowStart),
    check('rate_limits_count_check', sql`count >= 0`),
  ],
)
