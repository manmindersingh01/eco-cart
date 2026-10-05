import { sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import { ValidationError } from '../errors.ts'

/*
 * Keyset pagination for every list in the app (CLAUDE.md: never OFFSET).
 * Lists are ordered newest first by (created_at, id), and the cursor holds
 * the last row's pair, so page 200 costs the same as page 1.
 *
 * The time travels as text with microseconds. A JavaScript Date keeps only
 * milliseconds, and rounding the cursor would repeat or skip rows created
 * within the same millisecond.
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

/** Rows that come after the cursor in newest-first order. */
export function afterCursor(
  cursor: string,
  createdAt: AnyPgColumn,
  id: AnyPgColumn,
): SQL {
  let parsed: z.infer<typeof cursorShape>
  try {
    parsed = cursorShape.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    )
  } catch {
    throw new ValidationError('That page cursor is not valid')
  }
  const [time, lastId] = parsed
  return sql`(${createdAt}, ${id}) < (${time}::timestamptz, ${lastId}::uuid)`
}

/**
 * Turns rows fetched with `limit + 1` into a page: the extra row only says
 * whether another page exists.
 */
export function toPage<Row extends { cursorTime: string; id: string }, T>(
  rows: Row[],
  limit: number,
  toItem: (row: Row) => T,
): Page<T> {
  const visible = rows.slice(0, limit)
  const last = visible.at(-1)
  return {
    items: visible.map(toItem),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor(last.cursorTime, last.id)
        : null,
  }
}
