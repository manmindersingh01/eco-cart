import { PgBoss } from 'pg-boss'

/*
 * Stands in for the worker when a test needs jobs that failed for good.
 * `connectionString` is a database user that may change the pgboss tables:
 * ecokart_worker, or the owner where a test has no worker user.
 */

export interface TestWorker {
  /**
   * Adds a job with no retries left and fails it the way pg-boss records a
   * handler's error: an Error, `{ value: { message } }` for a timeout, or
   * nothing. Returns the job's id.
   */
  failJob(queue: string, data: object, output?: object): Promise<string>
  /** Adds a job that waits to run. */
  addJob(queue: string, data: object): Promise<string>
  /** Refreshes a queue's counts now instead of once a minute. */
  countJobs(queue: string): Promise<void>
  stop(): Promise<void>
}

function added(id: string | null): string {
  if (!id) throw new Error('pg-boss did not add the job')
  return id
}

export async function startTestWorker(
  connectionString: string,
): Promise<TestWorker> {
  const boss = new PgBoss({
    connectionString,
    application_name: 'ecokart-test-worker',
    max: 2,
    migrate: false,
    supervise: false,
    schedule: false,
  })
  boss.on('error', (error) => {
    console.error('Test worker error', error)
  })
  await boss.start()
  return {
    async failJob(queue, data, output) {
      const id = added(await boss.send(queue, data, { retryLimit: 0 }))
      await boss.fail(queue, id, output)
      return id
    },
    async addJob(queue, data) {
      return added(await boss.send(queue, data))
    },
    countJobs: (queue) => boss.supervise(queue),
    stop: () => boss.stop(),
  }
}
