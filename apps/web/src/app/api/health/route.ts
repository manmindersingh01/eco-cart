import { checkDatabase } from '@ecokart/core'
import { getPool } from '@/lib/db'

/**
 * Health check for the load balancer and post-deploy smoke tests.
 * Returns 503 when the database is unreachable, without exposing why.
 */
export async function GET(): Promise<Response> {
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
