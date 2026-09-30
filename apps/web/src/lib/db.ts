import { createPool, requireEnv, type DatabasePool } from '@ecokart/core'

// Next.js dev re-runs modules on every edit. Keeping the pool on globalThis
// stops each reload from opening another set of database connections.
const globalForDb = globalThis as typeof globalThis & {
  ecokartDbPool?: DatabasePool
}

export function getPool(): DatabasePool {
  globalForDb.ecokartDbPool ??= createPool(
    requireEnv('DATABASE_URL'),
    'ecokart-web',
  )
  return globalForDb.ecokartDbPool
}

export async function closePool(): Promise<void> {
  const pool = globalForDb.ecokartDbPool
  globalForDb.ecokartDbPool = undefined
  await pool?.end()
}
