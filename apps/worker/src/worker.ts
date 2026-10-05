import { PgBoss } from 'pg-boss'

/**
 * Starts the pg-boss job queue as the ecokart_worker database user.
 *
 * The queue tables are installed and upgraded by `pnpm db:migrate`, because
 * this user may not change tables. With `migrate: false`, start() checks that
 * the tables exist at the expected version and fails with a clear error
 * otherwise.
 */
export async function startWorker(databaseUrl: string): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: databaseUrl,
    application_name: 'ecokart-worker',
    migrate: false,
  })

  // pg-boss requires an error listener; without one a failed maintenance
  // query would crash the process instead of being logged and retried.
  boss.on('error', (error) => {
    console.error('Job queue error', error)
  })

  try {
    await boss.start()
  } catch (error) {
    // start() may already have opened its connection pool.
    await boss.stop()
    throw explainStartFailure(error)
  }

  // Each module registers its queues and job handlers here as it is built.

  return boss
}

// pg-boss's own messages when its tables are missing or older than the code.
const NOT_MIGRATED = new Set([
  'pg-boss is not installed',
  'pg-boss database requires migrations',
])

function explainStartFailure(error: unknown): unknown {
  if (error instanceof Error && NOT_MIGRATED.has(error.message)) {
    return new Error(
      'The job queue tables are missing or out of date. Run `pnpm db:migrate`, then start the worker again.',
      { cause: error },
    )
  }
  return error
}
