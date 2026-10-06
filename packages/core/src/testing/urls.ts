// Kept free of heavy imports, because every package's vitest.config.ts loads
// it to fill in the test environment.

const DEFAULT_SERVER_URL = 'postgres://ecokart:ecokart@localhost:5434/postgres'

// The same values as the .env.example files, because role passwords are
// shared by every database on the server.
export const TEST_WEB_PASSWORD = 'ecokart_web'
export const TEST_WORKER_PASSWORD = 'ecokart_worker'

export interface TestDatabase {
  name: string
  /** The server's maintenance database, used to drop and create `name`. */
  serverUrl: string
  /** The owner, for migrations and for test fixtures that skip RLS. */
  migrationUrl: string
  /** The web app's user, subject to row-level security. */
  webUrl: string
  /** The worker's user. */
  workerUrl: string
}

/**
 * Each package tests against its own database, ecokart_test_<suffix>, so test
 * runs never touch the development database or each other. The server comes
 * from TEST_DATABASE_SERVER_URL (CI) or the local compose.yaml database.
 */
export function testDatabase(
  suffix: string,
  serverUrl: string = process.env.TEST_DATABASE_SERVER_URL ??
    DEFAULT_SERVER_URL,
): TestDatabase {
  const name = `ecokart_test_${suffix}`
  const urlFor = (user?: string, password?: string): string => {
    const url = new URL(serverUrl)
    url.pathname = `/${name}`
    if (user !== undefined && password !== undefined) {
      url.username = user
      url.password = password
    }
    return url.href
  }
  return {
    name,
    serverUrl,
    migrationUrl: urlFor(),
    webUrl: urlFor('ecokart_web', TEST_WEB_PASSWORD),
    workerUrl: urlFor('ecokart_worker', TEST_WORKER_PASSWORD),
  }
}

const DEFAULT_STORAGE_ENDPOINT = 'http://localhost:8333'

/**
 * Storage settings for a package's tests: its own bucket, ecokart-test-<suffix>,
 * on the compose.yaml storage service or CI's (TEST_STORAGE_ENDPOINT).
 */
export function testStorageEnv(
  suffix: string,
  endpoint: string = process.env.TEST_STORAGE_ENDPOINT ??
    DEFAULT_STORAGE_ENDPOINT,
): Record<string, string> {
  const bucket = `ecokart-test-${suffix}`
  return {
    STORAGE_BUCKET: bucket,
    STORAGE_REGION: 'ap-south-1',
    STORAGE_ENDPOINT: endpoint,
    // The same values as compose.yaml and the CI service.
    STORAGE_ACCESS_KEY_ID: 'ecokart',
    STORAGE_SECRET_ACCESS_KEY: 'development-only-storage-secret',
    STORAGE_PUBLIC_URL: `${endpoint}/${bucket}`,
  }
}
