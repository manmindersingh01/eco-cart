import { checkDatabase } from '@ecokart/core'
import { connection } from 'next/server'
import { getPool } from '@/lib/db'

/**
 * Health check for the load balancer and post-deploy smoke tests.
 * Returns 503 when the database is unreachable, without exposing why.
 */
export async function GET(): Promise<Response> {
  // Checked on every request: with Cache Components, `next build` would
  // otherwise prerender this route once and serve that answer for ever.
  await connection()
  try {
    await checkDatabase(getPool())
    return Response.json({ status: 'ok', database: 'ok' })
  } catch (error) {
    console.error('Health check failed', error)
    return Response.json(
      { status: 'error', database: 'unreachable' },
      { status: 503 },
    )
  }
}
