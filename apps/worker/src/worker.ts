import {
  createDatabase,
  createObjectStorage,
  createPool,
  loadNotificationConfig,
  QUEUES,
  registerNotificationJobs,
  type StorageConfig,
} from '@ecokart/core'
import { registerCatalogueJobs } from '@ecokart/core/worker'
import { PgBoss } from 'pg-boss'

export interface WorkerOptions {
  databaseUrl: string
  notifications: ReturnType<typeof loadNotificationConfig>
  storage: StorageConfig
}

export interface RunningWorker {
  boss: PgBoss
  /** Lets running jobs finish (pg-boss waits up to 30 seconds), then closes. */
  stop(): Promise<void>
}

/**
 * Starts the pg-boss job queue as the ecokart_worker database user and
 * registers every module's jobs.
 *
 * The queue tables and the queues themselves are created by
 * `pnpm db:migrate`, because this user may not change tables. With
 * `migrate: false`, start() checks that the tables exist at the expected
 * version and fails with a clear error otherwise.
 */
export async function startWorker(
  options: WorkerOptions,
): Promise<RunningWorker> {
  const boss = new PgBoss({
    connectionString: options.databaseUrl,
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
    await assertQueuesExist(boss)
  } catch (error) {
    // start() may already have opened its connection pool.
    await boss.stop()
    throw explainStartFailure(error)
  }

  // Job handlers read and write through Drizzle on their own small pool.
  const pool = createPool(options.databaseUrl, 'ecokart-worker-jobs')
  const db = createDatabase(pool)
  await registerNotificationJobs(boss, { db, ...options.notifications })
  await registerCatalogueJobs(boss, {
    db,
    storage: createObjectStorage(options.storage),
  })

  return {
    boss,
    async stop() {
      await boss.stop()
      await pool.end()
    },
  }
}

/**
 * A queue that `pnpm db:migrate` has not created yet would make its jobs fail
 * quietly in the background, so the worker refuses to start instead.
 */
async function assertQueuesExist(boss: PgBoss): Promise<void> {
  const missing: string[] = []
  for (const { name } of QUEUES) {
    if (!(await boss.getQueue(name))) missing.push(name)
  }
  if (missing.length > 0) {
    throw new Error(
      `The job queues ${missing.join(', ')} are missing. Run \`pnpm db:migrate\`, then start the worker again.`,
    )
  }
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
