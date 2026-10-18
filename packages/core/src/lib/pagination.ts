import { sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import { ValidationError } from '../errors.ts'

/*
 * Keyset pagination for every list in the app (CLAUDE.md: never OFFSET).
 * The cursor holds the last row's sort key, so page 200 costs the same as
 * page 1. Two orders exist:
 *
 * - Newest first by (created_at, id). The time travels as text with
 *   microseconds: a JavaScript Date keeps only milliseconds, and rounding the
 *   cursor would repeat or skip rows created within the same millisecond.
 * - A to Z by a unique text key, for example a brand's name in small letters.
 */

export interface Page<T> {
  items: T[]
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null
}

export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 100

export function pageSize(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_PAGE_SIZE
  if (!Number.isInteger(requested) || requested < 1) {
    throw new ValidationError('limit must be a whole number of at least 1')
  }
  return Math.min(requested, MAX_PAGE_SIZE)
}

/** Selects a timestamptz column as exact UTC text, for building a cursor. */
export const exactTime = (column: AnyPgColumn) =>
  sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

const cursorShape = z.tuple([
  z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
  z.uuid(),
])

export function encodeCursor(time: string, id: string): string {
  return Buffer.from(JSON.stringify([time, id])).toString('base64url')
}

function decodeCursor<S extends z.ZodType>(
  cursor: string,
  shape: S,
): z.output<S> {
  try {
    return shape.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    )
  } catch {
    throw new ValidationError('That page cursor is not valid')
  }
}

/** Rows that come after the cursor in newest-first order. */
export function afterCursor(
  cursor: string,
  createdAt: AnyPgColumn,
  id: AnyPgColumn,
): SQL {
  const [time, lastId] = decodeCursor(cursor, cursorShape)
  return sql`(${createdAt}, ${id}) < (${time}::timestamptz, ${lastId}::uuid)`
}

/** The newest-first cursor of a row selected with `exactTime`. */
export const newestFirstCursor = (row: { cursorTime: string; id: string }) =>
  encodeCursor(row.cursorTime, row.id)

const textCursorShape = z.tuple([z.literal('az'), z.string().max(1000)])

export function encodeTextCursor(key: string): string {
  return Buffer.from(JSON.stringify(['az', key])).toString('base64url')
}

/**
 * Rows that come after the cursor in A to Z order of `key`, which must be
 * unique (backed by a unique index) so no two rows tie.
 */
export function afterTextCursor(cursor: string, key: SQL): SQL {
  const [, last] = decodeCursor(cursor, textCursorShape)
  return sql`${key} > ${last}`
}

/**
 * Turns rows fetched with `limit + 1` into a page: the extra row only says
 * whether another page exists. `cursorOf` builds the next cursor from the
 * last row shown.
 */
export function toPage<Row, T>(
  rows: Row[],
  limit: number,
  toItem: (row: Row) => T,
  cursorOf: (row: Row) => string,
): Page<T> {
  const visible = rows.slice(0, limit)
  const last = visible.at(-1)
  return {
    items: visible.map(toItem),
    nextCursor: rows.length > limit && last ? cursorOf(last) : null,
  }
}

/*
 * Orders by one key and then id, ascending or descending, for the storefront
 * (backend spec step 9): newest by publication time, by price, and by search
 * rank. The cursor carries the name of its order, so a cursor from another
 * order is refused instead of returning a wrong page.
 */

/** How the key travels in the cursor and is cast back in SQL. */
export type CursorKeyType = 'timestamptz' | 'bigint' | 'numeric'

const keyShapes: Record<CursorKeyType, z.ZodString> = {
  // Microseconds, as exactTime selects it.
  timestamptz: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
  bigint: z.string().regex(/^-?\d{1,19}$/),
  // Search ranks are rounded in SQL, so the text compares exactly.
  numeric: z.string().regex(/^-?\d{1,20}(\.\d{1,20})?$/),
}

const orderName = z.string().regex(/^[a-z_-]{1,40}$/)

/** `key` is the row's sort key as text, for example a price in paise. */
export function encodeKeyCursor(
  order: string,
  key: string,
  id: string,
): string {
  return Buffer.from(JSON.stringify([order, key, id])).toString('base64url')
}

/** The order a cursor was made for, so a caller can choose how to continue. */
export function cursorOrder(cursor: string): string {
  const [order] = decodeCursor(
    cursor,
    z.tuple([orderName, z.string(), z.string()]),
  )
  return order
}

/** Rows after the cursor in `order`, sorted by (`key`, `id`) in `direction`. */
export function afterKeyCursor(
  cursor: string,
  order: string,
  key: AnyPgColumn | SQL,
  id: AnyPgColumn,
  direction: 'asc' | 'desc',
  type: CursorKeyType,
): SQL {
  const [, last, lastId] = decodeCursor(
    cursor,
    z.tuple([z.literal(order), keyShapes[type], z.uuid()]),
  )
  const after = direction === 'asc' ? sql`>` : sql`<`
  return sql`(${key}, ${id}) ${after} (${last}::${sql.raw(type)}, ${lastId}::uuid)`
}
