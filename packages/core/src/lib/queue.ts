import { sql } from 'drizzle-orm'
import { fromDrizzle, PgBoss, type QueueOptions } from 'pg-boss'
import type { Transaction } from '../db/client.ts'

/**
 * A queue and its retry settings. Every queue is created by
 * `pnpm db:migrate`, so neither program needs to change the pgboss tables.
 * Only options that pg-boss can also update later are allowed here.
 */
export interface QueueDefinition {
  name: string
  options: Pick<
    QueueOptions,
    | 'retryLimit'
    | 'retryDelay'
    | 'retryBackoff'
    | 'expireInSeconds'
    | 'retentionSeconds'
    | 'deleteAfterSeconds'
  >
}

/** How the web app adds background jobs. */
export interface JobQueue {
  /**
   * Adds a job inside `tx`, so it exists only if the business change it
   * belongs to commits. For example, an OTP email job is never left behind
   * by a request that failed.
   */
  send(tx: Transaction, queue: string, data: object): Promise<void>
  stop(): Promise<void>
}

/**
 * Starts a pg-boss client that only sends jobs: no maintenance, no
 * schedules, and a small pool, because the worker does all the rest.
 */
export async function startJobQueue(
  connectionString: string,
  applicationName: string,
): Promise<JobQueue> {
  const boss = new PgBoss({
    connectionString,
    application_name: applicationName,
    max: 2,
    migrate: false,
    supervise: false,
    schedule: false,
  })
  boss.on('error', (error) => {
    console.error('Job queue error', error)
  })
  await boss.start()
  return {
    async send(tx, queue, data) {
      await boss.send(queue, data, { db: fromDrizzle(tx, sql) })
    },
    stop: () => boss.stop(),
  }
}
