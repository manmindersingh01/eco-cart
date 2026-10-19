import { and, desc, eq, sql } from 'drizzle-orm'
import { integer, jsonb, pgSchema, text, uuid } from 'drizzle-orm/pg-core'
import { fromDrizzle, PgBoss, type QueueOptions } from 'pg-boss'
import { z } from 'zod'
import type { Transaction } from '../db/client.ts'
import { timestamptz } from '../db/schema/columns.ts'
import {
  afterCursor,
  exactTime,
  newestFirstCursor,
  pageSize,
  toPage,
  type Page,
} from './pagination.ts'

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

/** How many jobs of one queue are in each state. */
export interface QueueCounts {
  name: string
  /** Ready to run now. */
  waiting: number
  /** Waiting for a retry delay or a start time. */
  deferred: number
  running: number
  /** Failed for good and not yet removed by the queue's clean-up. */
  failed: number
}

export type JobState =
  'created' | 'retry' | 'active' | 'completed' | 'cancelled' | 'failed'

export interface QueuedJob {
  id: string
  state: JobState
}

/** How the web app adds background jobs and looks after failed ones. */
export interface JobQueue {
  /**
   * Adds a job inside `tx`, so it exists only if the business change it
   * belongs to commits. For example, an OTP email job is never left behind
   * by a request that failed.
   */
  send(tx: Transaction, queue: string, data: object): Promise<void>
  /**
   * The counts pg-boss keeps for each queue. The worker refreshes them about
   * once a minute, so they can trail the jobs themselves by that much.
   */
  counts(queues: string[]): Promise<QueueCounts[]>
  /** One job, read inside `tx`, or null once pg-boss has removed it. */
  findJob(tx: Transaction, queue: string, id: string): Promise<QueuedJob | null>
  /** Every job in `queue` whose data contains `data`, in any state. */
  findJobsWithData(
    tx: Transaction,
    queue: string,
    data: object,
  ): Promise<QueuedJob[]>
  /**
   * Gives a failed job one more attempt, inside `tx`. False when the job was
   * not failed, for example because someone else retried it first.
   */
  retry(tx: Transaction, queue: string, id: string): Promise<boolean>
  stop(): Promise<void>
}

/** pg-boss runs the statement inside the caller's transaction. */
const inside = (tx: Transaction) => ({ db: fromDrizzle(tx, sql) })

// pg-boss declares the result of retry() as an empty object, but it returns
// how many jobs it changed.
const retried = z.object({ affected: z.number() })

/**
 * Starts a pg-boss client that only sends and looks up jobs: no maintenance,
 * no schedules, and a small pool, because the worker does all the rest.
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
  return { ...jobQueueOf(boss), stop: () => boss.stop() }
}

/**
 * Sends jobs through a pg-boss client that is already running, such as the
 * worker's, for a job that queues more jobs. Stopping it is left to whoever
 * started the client.
 */
export function jobQueueOf(boss: PgBoss): JobQueue {
  return {
    async send(tx, queue, data) {
      await boss.send(queue, data, inside(tx))
    },
    async counts(queues) {
      const found = await boss.getQueues(queues)
      return found.map((queue) => ({
        name: queue.name,
        waiting: queue.readyCount,
        deferred: queue.deferredCount,
        running: queue.activeCount,
        failed: queue.failedCount,
      }))
    },
    async findJob(tx, queue, id) {
      const job = await boss.getJobById(queue, id, inside(tx))
      return job ? { id: job.id, state: job.state } : null
    },
    async findJobsWithData(tx, queue, data) {
      const jobs = await boss.findJobs(queue, { data, ...inside(tx) })
      return jobs.map((job) => ({ id: job.id, state: job.state }))
    },
    async retry(tx, queue, id) {
      const result = await boss.retry(queue, id, inside(tx))
      return retried.parse(result).affected > 0
    },
    stop: async () => {},
  }
}

/*
 * pg-boss has no call that lists one state of a queue a page at a time:
 * `findJobs` returns every job of the queue, finished ones included. So the
 * failed jobs are read from its job table directly, with only the columns
 * shown here. pg-boss removes a failed job once the queue's
 * `deleteAfterSeconds` has passed (seven days unless the queue says less), so
 * the rows read stay few.
 */
const pgboss = pgSchema('pgboss')
const bossJobs = pgboss.table('job', {
  id: uuid('id').notNull(),
  name: text('name').notNull(),
  state: text('state').notNull(),
  data: jsonb('data'),
  output: jsonb('output'),
  retryCount: integer('retry_count').notNull(),
  createdOn: timestamptz('created_on').notNull(),
  completedOn: timestamptz('completed_on'),
})

export interface FailedJob {
  id: string
  data: unknown
  /** What pg-boss stored about the failure: the error thrown, or a timeout. */
  output: unknown
  /** How many times it was tried again after the first attempt. */
  retryCount: number
  createdAt: Date
  failedAt: Date
}

/** Failed jobs of one queue, the most recent failure first. */
export async function readFailedJobs(
  tx: Transaction,
  queue: string,
  options: { cursor?: string | undefined; limit?: number | undefined },
): Promise<Page<FailedJob>> {
  const limit = pageSize(options.limit)
  const rows = await tx
    .select({
      id: bossJobs.id,
      data: bossJobs.data,
      output: bossJobs.output,
      retryCount: bossJobs.retryCount,
      createdAt: bossJobs.createdOn,
      // A failed job's completed_on is when it failed.
      failedAt: bossJobs.completedOn,
      cursorTime: exactTime(bossJobs.completedOn),
    })
    .from(bossJobs)
    .where(
      and(
        eq(bossJobs.name, queue),
        eq(bossJobs.state, 'failed'),
        options.cursor
          ? afterCursor(options.cursor, bossJobs.completedOn, bossJobs.id)
          : undefined,
      ),
    )
    .orderBy(desc(bossJobs.completedOn), desc(bossJobs.id))
    .limit(limit + 1)
  return toPage(
    rows,
    limit,
    ({ cursorTime: _cursor, failedAt, ...job }) => ({
      ...job,
      failedAt: failedAt ?? job.createdAt,
    }),
    newestFirstCursor,
  )
}
