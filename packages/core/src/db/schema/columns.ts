import { sql } from 'drizzle-orm'
import { bigint, customType, timestamp, uuid } from 'drizzle-orm/pg-core'

/** UUID primary key for anything that can appear in a URL (design doc 5.1). */
export const uuidPrimaryKey = () => uuid('id').primaryKey().defaultRandom()

/** Every time is stored as timestamptz and shown in Asia/Kolkata. */
export const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' })

export const createdAt = () => timestamptz('created_at').notNull().defaultNow()

/** Kept current by the app.set_updated_at() trigger, not by application code. */
export const updatedAt = () => timestamptz('updated_at').notNull().defaultNow()

/**
 * Money is a whole number of paise in a bigint column. It is read as a
 * JavaScript number, which is exact for every amount EcoKart can hold.
 */
export const paise = (name: string) => bigint(name, { mode: 'number' })

export const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector'
  },
})

/** Who caused a logged change, for order_events and audit_logs. */
export const actorRoleCheck = () =>
  sql`actor_role in ('buyer', 'seller', 'admin', 'system')`
