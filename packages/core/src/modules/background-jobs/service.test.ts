import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import { auditLogs } from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../errors.ts'
import { QUEUES } from '../../jobs.ts'
import { startJobQueue, type JobQueue } from '../../lib/queue.ts'
import { createTestUser } from '../../testing/fixtures.ts'
import { startTestWorker, type TestWorker } from '../../testing/jobs.ts'
import { RENDER_INVOICE_QUEUE } from '../invoices/service.ts'
import { SEND_EMAIL_QUEUE, SEND_SMS_QUEUE } from '../notifications/jobs.ts'
import {
  listFailedJobs,
  listJobQueues,
  retryFailedJob,
  type FailedJobView,
} from './service.ts'

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'background-jobs-test')
  pools.push(pool)
  return createDatabase(pool)
}
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))
const web = connect(requireEnv('DATABASE_URL'))
let queue: JobQueue
let worker: TestWorker
let admin: Extract<RequestContext, { role: 'admin' }>
let buyer: RequestContext

beforeAll(async () => {
  queue = await startJobQueue(
    requireEnv('DATABASE_URL'),
    'background-jobs-test',
  )
  worker = await startTestWorker(requireEnv('WORKER_DATABASE_URL'))
  admin = { role: 'admin', userId: (await createTestUser(owner, 'admin')).id }
  buyer = { role: 'buyer', userId: (await createTestUser(owner)).id }
})

afterAll(async () => {
  await queue.stop()
  await worker.stop()
  await Promise.all(pools.map((pool) => pool.end()))
})

const failedJob = (name: string, data: object, output?: object) =>
  worker.failJob(name, data, output)

const failedJobs = (
  name: string,
  options: { cursor?: string; limit?: number } = {},
  context: RequestContext = admin,
) =>
  withContext(web, context, (tx) => listFailedJobs(tx, context, name, options))

/** Every page of a queue's failed jobs, two at a time. */
async function everyPage(name: string): Promise<FailedJobView[]> {
  const shown: FailedJobView[] = []
  let cursor: string | undefined
  do {
    const page = await failedJobs(name, {
      limit: 2,
      ...(cursor ? { cursor } : {}),
    })
    expect(page.items.length).toBeLessThanOrEqual(2)
    shown.push(...page.items)
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return shown
}

const retry = (name: string, id: string, context: RequestContext = admin) =>
  withContext(web, context, (tx) =>
    retryFailedJob(tx, context, queue, name, id, '203.0.113.9'),
  )

async function stateOf(id: string): Promise<string | undefined> {
  const { rows } = await owner.execute<{ state: string }>(
    sql`select state::text from pgboss.job where id = ${id}`,
  )
  return rows[0]?.state
}

describe('the queues', () => {
  test('lists every queue in src/jobs.ts with its counts', async () => {
    await failedJob(RENDER_INVOICE_QUEUE, { invoiceId: crypto.randomUUID() })
    // The worker refreshes the counts about once a minute; this does it now.
    await worker.countJobs(RENDER_INVOICE_QUEUE)

    const queues = await listJobQueues(admin, queue)
    expect(queues.map(({ name }) => name)).toEqual(
      QUEUES.map(({ name }) => name),
    )
    for (const counts of queues) {
      for (const count of [
        counts.waiting,
        counts.deferred,
        counts.running,
        counts.failed,
      ]) {
        expect(Number.isInteger(count) && count >= 0).toBe(true)
      }
    }
    const invoices = queues.find(({ name }) => name === RENDER_INVOICE_QUEUE)
    expect(invoices?.failed).toBeGreaterThanOrEqual(1)
  })

  test('are for administrators only', async () => {
    await expect(listJobQueues(buyer, queue)).rejects.toThrow(
      new ForbiddenError('Only administrators can look after jobs'),
    )
  })
})

describe('the failed jobs of a queue', () => {
  test('come most recent failure first, a page at a time, with their errors', async () => {
    const invoiceId = crypto.randomUUID()
    const thrown = await failedJob(
      RENDER_INVOICE_QUEUE,
      { invoiceId },
      new Error('The invoice PDF could not be rendered'),
    )
    const timedOut = await failedJob(
      RENDER_INVOICE_QUEUE,
      { invoiceId: crypto.randomUUID() },
      { value: { message: 'job timed out' } },
    )
    const silent = await failedJob(RENDER_INVOICE_QUEUE, {
      invoiceId: crypto.randomUUID(),
    })
    const waiting = await worker.addJob(RENDER_INVOICE_QUEUE, {
      invoiceId: crypto.randomUUID(),
    })
    const mine = new Set([thrown, timedOut, silent, waiting])

    const shown = (await everyPage(RENDER_INVOICE_QUEUE)).filter(({ id }) =>
      mine.has(id),
    )
    expect(shown.map(({ id, error }) => [id, error])).toEqual([
      [silent, null],
      [timedOut, 'job timed out'],
      [thrown, 'The invoice PDF could not be rendered'],
    ])
    expect(shown[2]).toEqual({
      id: thrown,
      queue: RENDER_INVOICE_QUEUE,
      data: { invoiceId },
      error: 'The invoice PDF could not be rendered',
      retries: 0,
      createdAt: expect.any(Date),
      failedAt: expect.any(Date),
    })
  })

  test('never show a sealed sign-in code', async () => {
    const to = `+9198${String(Date.now()).slice(-8)}`
    const id = await failedJob(
      SEND_SMS_QUEUE,
      { to, code: 'v1.sealed.code', expiresAt: '2026-10-18T10:05:00.000Z' },
      new Error('SMS provider unavailable'),
    )
    const [job] = (await everyPage(SEND_SMS_QUEUE)).filter(
      (shown) => shown.id === id,
    )
    expect(job?.data).toEqual({ to, expiresAt: '2026-10-18T10:05:00.000Z' })
  })

  test('refuse a queue or cursor that does not exist', async () => {
    await expect(failedJobs('nothing.here')).rejects.toThrow(
      new NotFoundError('There is no job queue with that name'),
    )
    await expect(
      failedJobs(RENDER_INVOICE_QUEUE, { cursor: 'not-a-cursor' }),
    ).rejects.toThrow(new ValidationError('That page cursor is not valid'))
  })

  test('are for administrators only', async () => {
    await expect(failedJobs(RENDER_INVOICE_QUEUE, {}, buyer)).rejects.toThrow(
      ForbiddenError,
    )
  })
})

describe('retrying a failed job', () => {
  test('gives it one more attempt and records who did it', async () => {
    const id = await failedJob(
      RENDER_INVOICE_QUEUE,
      { invoiceId: crypto.randomUUID() },
      new Error('Storage was unavailable'),
    )
    expect(await retry(RENDER_INVOICE_QUEUE, id)).toEqual({
      id,
      queue: RENDER_INVOICE_QUEUE,
    })
    expect(await stateOf(id)).toBe('retry')
    expect(
      (await everyPage(RENDER_INVOICE_QUEUE)).some((job) => job.id === id),
    ).toBe(false)
    const [audit] = await owner
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'job.retry'), eq(auditLogs.entityId, id)))
    expect(audit).toMatchObject({
      actorUserId: admin.userId,
      actorRole: 'admin',
      entityType: 'job',
      before: { queue: RENDER_INVOICE_QUEUE, state: 'failed' },
      after: { queue: RENDER_INVOICE_QUEUE, state: 'retry' },
      ip: '203.0.113.9',
    })

    await expect(retry(RENDER_INVOICE_QUEUE, id)).rejects.toThrow(
      new ConflictError(
        'This job has not failed, so there is nothing to retry',
      ),
    )
  })

  test('only one of two administrators retrying together succeeds', async () => {
    const id = await failedJob(RENDER_INVOICE_QUEUE, {
      invoiceId: crypto.randomUUID(),
    })
    const results = await Promise.allSettled([
      retry(RENDER_INVOICE_QUEUE, id),
      retry(RENDER_INVOICE_QUEUE, id),
    ])
    expect(results.map(({ status }) => status).toSorted()).toEqual([
      'fulfilled',
      'rejected',
    ])
    const audits = await owner
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'job.retry'), eq(auditLogs.entityId, id)))
    expect(audits).toHaveLength(1)
  })

  test('leaves emails to the email list and never resends a sign-in code', async () => {
    const email = await failedJob(SEND_EMAIL_QUEUE, { outboxId: 1 })
    await expect(retry(SEND_EMAIL_QUEUE, email)).rejects.toThrow(
      new ConflictError(
        'Emails are retried from the email list, which also gives them fresh attempts',
      ),
    )
    const sms = await failedJob(SEND_SMS_QUEUE, {
      to: '+919800000000',
      code: 'v1.sealed.code',
      expiresAt: '2026-10-18T10:05:00.000Z',
    })
    await expect(retry(SEND_SMS_QUEUE, sms)).rejects.toThrow(
      new ConflictError(
        'A sign-in code expires within minutes, so it is never sent again; the person asks for a new code instead',
      ),
    )
    expect([await stateOf(email), await stateOf(sms)]).toEqual([
      'failed',
      'failed',
    ])
  })

  test('answers 404 for a job or queue that does not exist, and 409 for a job that has not failed', async () => {
    for (const id of [crypto.randomUUID(), 'abc']) {
      await expect(retry(RENDER_INVOICE_QUEUE, id)).rejects.toThrow(
        new NotFoundError('There is no job with that id in this queue'),
      )
    }
    const waiting = await worker.addJob(RENDER_INVOICE_QUEUE, {
      invoiceId: crypto.randomUUID(),
    })
    await expect(retry('nothing.here', waiting)).rejects.toThrow(
      new NotFoundError('There is no job queue with that name'),
    )
    await expect(retry(RENDER_INVOICE_QUEUE, waiting)).rejects.toThrow(
      ConflictError,
    )
    expect(await stateOf(waiting)).toBe('created')
  })

  test('is for administrators only', async () => {
    const id = await failedJob(RENDER_INVOICE_QUEUE, {
      invoiceId: crypto.randomUUID(),
    })
    await expect(retry(RENDER_INVOICE_QUEUE, id, buyer)).rejects.toThrow(
      ForbiddenError,
    )
    expect(await stateOf(id)).toBe('failed')
  })
})
