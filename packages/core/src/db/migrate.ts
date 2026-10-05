import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'
import { requireEnv } from '../env.ts'
import { scramSha256Verifier } from './scram.ts'

const MIGRATIONS_FOLDER = fileURLToPath(
  new URL('./migrations', import.meta.url),
)

// Any fixed number works; every run of this command must use the same one so
// two deploys can never migrate the same database at once.
const MIGRATION_LOCK_KEY = 726_001

export interface MigrateOptions {
  /** A connection as the database owner, the only user that changes tables. */
  migrationUrl: string
  /** Login password for the ecokart_web user. */
  webPassword: string
  /** Login password for the ecokart_worker user. */
  workerPassword: string
  log?: (message: string) => void
}

/**
 * Brings a database fully up to date (backend spec, step 1):
 * 1. applies new SQL migrations from src/db/migrations,
 * 2. lets ecokart_web and ecokart_worker log in with the given passwords,
 * 3. installs or upgrades the pg-boss job queue tables,
 * 4. grants both users access to the job queue tables.
 * Safe to run again; it changes nothing that is already up to date.
 */
export async function migrateDatabase(options: MigrateOptions): Promise<void> {
  const log = options.log ?? (() => {})
  const client = new Client({
    connectionString: options.migrationUrl,
    application_name: 'ecokart-migrate',
  })
  await client.connect()
  try {
    // A session lock, released when this connection closes.
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])

    const before = await appliedMigrationCount(client)
    await migrate(drizzle({ client }), { migrationsFolder: MIGRATIONS_FOLDER })
    const applied = (await appliedMigrationCount(client)) - before
    log(
      applied === 0
        ? 'Database schema is up to date'
        : `Applied ${applied} database migration${applied === 1 ? '' : 's'}`,
    )

    await setLoginPassword(client, 'ecokart_web', options.webPassword)
    await setLoginPassword(client, 'ecokart_worker', options.workerPassword)
    log('Database users ecokart_web and ecokart_worker can log in')

    log(await migrateJobQueue(options.migrationUrl))
    await grantJobQueue(client)
  } finally {
    await client.end()
  }
}

async function appliedMigrationCount(client: Client): Promise<number> {
  // Drizzle creates its bookkeeping table on the first run.
  const exists = await client.query<{ exists: boolean }>(
    `select to_regclass('drizzle.__drizzle_migrations') is not null as exists`,
  )
  if (!exists.rows[0]?.exists) return 0
  const { rows } = await client.query<{ count: number }>(
    'select count(*)::int as count from drizzle.__drizzle_migrations',
  )
  return rows[0]?.count ?? 0
}

async function setLoginPassword(
  client: Client,
  role: 'ecokart_web' | 'ecokart_worker',
  password: string,
): Promise<void> {
  const verifier = scramSha256Verifier(password)
  await client.query(
    `alter role ${role} with login password ${client.escapeLiteral(verifier)}`,
  )
}

/**
 * Runs pg-boss's own `migrate` command as the database owner. It creates the
 * pgboss schema on a fresh database, and on an upgrade it builds new indexes
 * straight away instead of leaving them for a running worker, which has no
 * permission to change tables.
 */
async function migrateJobQueue(migrationUrl: string): Promise<string> {
  const require = createRequire(import.meta.url)
  const cli = join(
    dirname(require.resolve('pg-boss/package.json')),
    'dist/cli.js',
  )
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [cli, 'migrate'],
    // The URL holds a password, so it goes in the environment, not the
    // command line that any process on the machine can read.
    { env: { ...process.env, PGBOSS_DATABASE_URL: migrationUrl } },
  )
  return stdout.trim()
}

/**
 * Both programs use the queue: the web app sends jobs and the worker runs
 * them. Queues are created without the `partition` option, so neither ever
 * needs to create a table.
 */
async function grantJobQueue(client: Client): Promise<void> {
  await client.query(`
    grant usage on schema pgboss to ecokart_web, ecokart_worker;
    grant select, insert, update, delete on all tables in schema pgboss to ecokart_web, ecokart_worker;
    grant usage, select on all sequences in schema pgboss to ecokart_web, ecokart_worker;
    grant execute on all functions in schema pgboss to ecokart_web, ecokart_worker;
  `)
}

if (import.meta.main) {
  try {
    await migrateDatabase({
      migrationUrl: requireEnv('MIGRATION_DATABASE_URL'),
      webPassword: requireEnv('WEB_DATABASE_PASSWORD'),
      workerPassword: requireEnv('WORKER_DATABASE_PASSWORD'),
      log: (message) => console.info(message),
    })
  } catch (error) {
    console.error('Migration failed', error)
    process.exitCode = 1
  }
}
