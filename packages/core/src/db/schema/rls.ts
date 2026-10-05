import { sql, type SQL } from 'drizzle-orm'
import { pgPolicy, pgRole } from 'drizzle-orm/pg-core'

/*
 * Row-level security building blocks (design doc section 8, backend spec
 * step 1). The roles are created by the first migration, so drizzle-kit only
 * refers to them and never creates or drops them.
 */
export const webRole = pgRole('ecokart_web').existing()
export const workerRole = pgRole('ecokart_worker').existing()

// The request context set by withContext(); see the app schema functions in
// the foundation migration.
export const currentUserId = sql`app.user_id()`
export const currentSellerId = sql`app.seller_id()`
export const currentGuestToken = sql`app.guest_token()`
export const fullAccess = sql`app.has_full_access()`

/**
 * True when the current user is the buyer of the order whose id is in
 * `column`, written as a qualified column name such as `invoices.order_id`.
 */
export const isOrderBuyer = (column: string) =>
  sql`exists (select 1 from orders o where o.id = ${sql.raw(column)} and o.user_id = ${currentUserId})`

/**
 * The worker runs trusted background jobs for every buyer and seller. It gets
 * an explicit policy instead of BYPASSRLS, which managed databases such as
 * Amazon RDS cannot grant, so the schema works on any PostgreSQL.
 */
export const workerPolicy = () =>
  pgPolicy('worker_all', {
    for: 'all',
    to: workerRole,
    using: sql`true`,
    withCheck: sql`true`,
  })

export const webSelect = (using: SQL) =>
  pgPolicy('web_select', { for: 'select', to: webRole, using })

export const webInsert = (withCheck: SQL) =>
  pgPolicy('web_insert', { for: 'insert', to: webRole, withCheck })

/** The same rule decides which rows can be changed and what they may become. */
export const webUpdate = (rule: SQL) =>
  pgPolicy('web_update', {
    for: 'update',
    to: webRole,
    using: rule,
    withCheck: rule,
  })

export const webDelete = (using: SQL) =>
  pgPolicy('web_delete', { for: 'delete', to: webRole, using })

/** One rule for reading, adding, changing, and removing rows. */
export const webAll = (rule: SQL) =>
  pgPolicy('web_all', { for: 'all', to: webRole, using: rule, withCheck: rule })
