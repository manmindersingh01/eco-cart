import { createAppAuth, loadAuthConfig, type Auth } from '@ecokart/core'
import { getDatabase } from './db'
import { getJobQueue } from './queue'

const globalForAuth = globalThis as typeof globalThis & { ecokartAuth?: Auth }

/**
 * Better Auth for this process, built on first use rather than at import, so
 * `next build` never needs the auth secrets.
 */
export function getAuth(): Auth {
  globalForAuth.ecokartAuth ??= createAppAuth({
    db: getDatabase(),
    getQueue: getJobQueue,
    config: loadAuthConfig(),
  })
  return globalForAuth.ecokartAuth
}

export function resetAuth(): void {
  globalForAuth.ecokartAuth = undefined
}
