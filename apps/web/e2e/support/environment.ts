import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { createPool } from '@ecokart/core'
import {
  deleteTestBucket,
  recreateTestBucket,
  recreateTestDatabase,
  testDatabase,
  testStorageEnv,
  worktreeTag,
} from '@ecokart/core/testing'

export function allocateEnvironment() {
  const id = randomBytes(6).toString('hex')
  const suffix = `e2e_${id}`
  const database = testDatabase(suffix)
  const storage = testStorageEnv(suffix.replaceAll('_', '-'))
  return { id, database, storage, tag: worktreeTag() }
}

export type TestEnvironment = ReturnType<typeof allocateEnvironment>

export function assertTestResources(resources: TestEnvironment): void {
  const { database, storage, id } = resources
  if (
    !/^[a-f0-9]{12}$/.test(id) ||
    !database.name.startsWith(`ecokart_test_e2e_${id}`)
  ) {
    throw new Error('Refusing a database outside this E2E run')
  }
  for (const url of [
    database.migrationUrl,
    database.webUrl,
    database.workerUrl,
  ]) {
    if (new URL(url).pathname !== `/${database.name}`) {
      throw new Error('Test database URLs do not match the owned resource')
    }
  }
  if (!storage.STORAGE_BUCKET?.startsWith(`ecokart-test-e2e-${id}`)) {
    throw new Error('Refusing a bucket outside this E2E run')
  }
  for (const target of [database.serverUrl, storage.STORAGE_ENDPOINT]) {
    if (
      !target ||
      !['localhost', '127.0.0.1', '[::1]'].includes(new URL(target).hostname)
    ) {
      throw new Error('E2E services must use loopback addresses')
    }
  }
}

const bind = (port: number) =>
  new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('No test port was allocated'))
        return
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)))
    })
  })
export async function availablePort(preferred = 3211): Promise<number> {
  try {
    return await bind(preferred)
  } catch {
    return bind(0)
  }
}

export async function prepareEnvironment(
  resources: TestEnvironment,
  origin: string,
) {
  assertTestResources(resources)
  await recreateTestDatabase(resources.database)
  await recreateTestBucket(resources.storage, [origin])
}

export async function removeEnvironment(
  resources: TestEnvironment,
): Promise<void> {
  assertTestResources(resources)
  const failures: unknown[] = []
  try {
    await deleteTestBucket(resources.storage)
  } catch (error) {
    failures.push(error)
  }
  const pool = createPool(resources.database.serverUrl, 'e2e-cleanup', {
    maxConnections: 1,
  })
  try {
    // The name passed the run-specific allowlist above; quote it regardless.
    const name = resources.database.name.replaceAll('"', '""')
    await pool.query(`drop database if exists "${name}" with (force)`)
  } catch (error) {
    failures.push(error)
  } finally {
    await pool.end()
  }
  if (failures.length)
    throw new AggregateError(failures, 'E2E resource cleanup failed')
}

export function childEnvironment(
  resources: TestEnvironment,
  origin: string,
): NodeJS.ProcessEnv {
  assertTestResources(resources)
  return {
    ...process.env,
    ...resources.storage,
    NODE_ENV: 'development',
    ECOKART_E2E: '1',
    E2E_RUN_ID: resources.id,
    E2E_BASE_URL: origin,
    DATABASE_URL: resources.database.webUrl,
    MIGRATION_DATABASE_URL: '',
    TEST_DATABASE_SERVER_URL: '',
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    MESSAGE_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    EMAIL_PROVIDER: 'mailpit',
    EMAIL_FROM: 'EcoKart <no-reply@ecokart.test>',
    MAILPIT_URL: process.env.MAILPIT_URL ?? 'http://localhost:8025',
    SMS_PROVIDER: 'mailpit',
    AI_ENABLED: 'false',
    AI_API_KEY: '',
    AI_EMBED_API_KEY: '',
    RAZORPAY_KEY_ID: '',
    RAZORPAY_KEY_SECRET: '',
    RAZORPAY_WEBHOOK_SECRET: '',
    RAZORPAY_API_URL: '',
  }
}
