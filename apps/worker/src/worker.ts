import { PgBoss } from 'pg-boss'

/**
 * Starts the pg-boss job queue. pg-boss creates and migrates its own
 * `pgboss` schema on start, so a fresh database needs no manual setup.
 */
export async function startWorker(databaseUrl: string): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: databaseUrl,
    application_name: 'ecokart-worker',
  })

  // pg-boss requires an error listener; without one a failed maintenance
  // query would crash the process instead of being logged and retried.
  boss.on('error', (error) => {
    console.error('Job queue error', error)
  })

  await boss.start()

  // Each module registers its queues and job handlers here as it is built.

  return boss
}
