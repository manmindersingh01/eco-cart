import { Pool } from 'pg'

export type DatabasePool = Pool

/**
 * Each container keeps one small pool (design doc section 3.1).
 * The application name shows up in pg_stat_activity, so it is easy to see
 * which service holds a connection.
 */
export function createPool(
  connectionString: string,
  applicationName: string,
  { maxConnections = 10 }: { maxConnections?: number } = {},
): DatabasePool {
  return new Pool({
    connectionString,
    application_name: applicationName,
    max: maxConnections,
  })
}

/** Resolves when the database answers a trivial query, rejects otherwise. */
export async function checkDatabase(pool: DatabasePool): Promise<void> {
  await pool.query('select 1')
}
