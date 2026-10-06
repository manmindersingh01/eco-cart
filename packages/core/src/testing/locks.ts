import { inArray, sql } from 'drizzle-orm'
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { Database } from '../db/client.ts'

/*
 * Helpers that make a race between transactions happen every time instead
 * of by luck: hold rows in a transaction of our own, start the racing
 * transactions, wait until they are all queued behind it, then let go.
 */

/**
 * Locks the rows of `table` whose `idColumn` is in `ids` until `release` is
 * called. `pid` is the holding transaction's database session.
 */
export async function holdRows(
  db: Database,
  table: PgTable,
  idColumn: AnyPgColumn,
  ids: string[],
): Promise<{ pid: number; release: () => void; finished: Promise<void> }> {
  const released = Promise.withResolvers<void>()
  const held = Promise.withResolvers<number>()
  const finished = db.transaction(async (tx) => {
    const result = await tx.execute<{ pid: number }>(
      sql`select pg_backend_pid() as pid`,
    )
    await tx.select().from(table).where(inArray(idColumn, ids)).for('update')
    held.resolve(result.rows[0]!.pid)
    await released.promise
  })
  // A failure before the rows are held must not leave the caller waiting.
  finished.catch(held.reject)
  return { pid: await held.promise, release: released.resolve, finished }
}

/** Sessions waiting on `pid`, directly or behind another waiting session. */
export async function sessionsWaitingOn(
  db: Database,
  pid: number,
): Promise<number> {
  const result = await db.execute<{ count: number }>(sql`
    select count(*)::int as count
    from pg_stat_activity a
    where ${pid} = any(pg_blocking_pids(a.pid))
       or exists (
         select 1 from pg_stat_activity b
         where b.pid = any(pg_blocking_pids(a.pid))
           and ${pid} = any(pg_blocking_pids(b.pid))
       )
  `)
  return result.rows[0]!.count
}

export async function waitUntil(
  condition: () => Promise<boolean>,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
