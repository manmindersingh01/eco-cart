import { Client } from 'pg'
import { migrateDatabase } from '../db/migrate.ts'
import {
  TEST_WEB_PASSWORD,
  TEST_WORKER_PASSWORD,
  type TestDatabase,
} from './urls.ts'

// Taken on the shared maintenance database, so the test setups of different
// packages take turns: they all set the same server-wide role passwords.
const SETUP_LOCK_KEY = 726_002

/** Drops the test database, creates it again, and runs every migration. */
export async function recreateTestDatabase(
  database: TestDatabase,
): Promise<void> {
  const server = new Client({ connectionString: database.serverUrl })
  await server.connect()
  try {
    await server.query('select pg_advisory_lock($1)', [SETUP_LOCK_KEY])
    const name = server.escapeIdentifier(database.name)
    await server.query(`drop database if exists ${name} with (force)`)
    await server.query(`create database ${name}`)
    await migrateDatabase({
      migrationUrl: database.migrationUrl,
      webPassword: TEST_WEB_PASSWORD,
      workerPassword: TEST_WORKER_PASSWORD,
    })
    await createTestCounters(database.migrationUrl)
  } finally {
    await server.end()
  }
}

/**
 * Counters that only test databases have. Invoice prefixes have just 4
 * characters, so random ones would collide now and then between test files
 * running at once; `testInvoicePrefixes` counts them here instead.
 */
async function createTestCounters(migrationUrl: string): Promise<void> {
  const client = new Client({ connectionString: migrationUrl })
  await client.connect()
  try {
    await client.query('create sequence test_invoice_prefixes')
  } finally {
    await client.end()
  }
}
