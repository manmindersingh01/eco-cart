import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { DatabasePool } from './pool.ts'
import * as schema from './schema/index.ts'

export type Database = NodePgDatabase<typeof schema>

/** A transaction handle, as passed to the callback of `db.transaction`. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

export function createDatabase(pool: DatabasePool): Database {
  return drizzle({ client: pool, schema })
}
