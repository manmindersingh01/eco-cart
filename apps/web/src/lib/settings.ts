import { loadAuthConfig, loadStorageConfig, requireEnv } from '@ecokart/core'

/**
 * Reads every setting the web app needs and stops with one clear error if
 * any is missing or still an example value in production. Called once when
 * the server starts (src/instrumentation.ts), so a bad deploy never takes
 * traffic, rather than failing on the first request that needs the setting.
 */
export function checkWebSettings(env: NodeJS.ProcessEnv = process.env): void {
  requireEnv('DATABASE_URL', env)
  loadAuthConfig(env)
  loadStorageConfig(env)
}
