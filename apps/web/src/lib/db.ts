import {
  createDatabase,
  createPool,
  requireEnv,
  type Database,
  type DatabasePool,
} from '@ecokart/core'

// Next.js dev re-runs modules on every edit. Keeping the pool on globalThis
// stops each reload from opening another set of database connections.
const globalForDb = globalThis as typeof globalThis & {
  ecokartDbPool?: DatabasePool
  ecokartDatabase?: Database
}

export function getPool(): DatabasePool {
  globalForDb.ecokartDbPool ??= createPool(
    requireEnv('DATABASE_URL'),
    'ecokart-web',
  )
  return globalForDb.ecokartDbPool
}

/** The Drizzle database, connected as ecokart_web. */
export function getDatabase(): Database {
  globalForDb.ecokartDatabase ??= createDatabase(getPool())
  return globalForDb.ecokartDatabase
}

export async function closePool(): Promise<void> {
  const pool = globalForDb.ecokartDbPool
  globalForDb.ecokartDbPool = undefined
  globalForDb.ecokartDatabase = undefined
  await pool?.end()
}
