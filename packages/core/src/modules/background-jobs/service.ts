import { z } from 'zod'
import type { Transaction } from '../../db/client.ts'
import type { RequestContext } from '../../db/context.ts'
import { ConflictError, ForbiddenError, NotFoundError } from '../../errors.ts'
import { QUEUES } from '../../jobs.ts'
import type { Page } from '../../lib/pagination.ts'
import {
  readFailedJobs,
  type FailedJob,
  type JobQueue,
  type QueueCounts,
} from '../../lib/queue.ts'
import { isUuid } from '../../lib/validation.ts'
import { recordAuditEntry } from '../audit/service.ts'
import { SEND_EMAIL_QUEUE, SEND_SMS_QUEUE } from '../notifications/jobs.ts'

/*
 * The administrator's view of background jobs that failed for good, queue by
 * queue. pg-boss keeps a failed job until the queue's `deleteAfterSeconds`
 * has passed, and an administrator can give it one more attempt. Emails are
 * looked after in the email list instead (notifications/outbox.ts).
 */

type Administrator = Extract<RequestContext, { role: 'admin' | 'system' }>

function assertAdministrator(
  context: RequestContext,
): asserts context is Administrator {
  if (context.role !== 'admin' && context.role !== 'system') {
    throw new ForbiddenError('Only administrators can look after jobs')
  }
}

export interface FailedJobView {
  id: string
  queue: string
  /** The job's data, without sealed sign-in codes. */
  data: unknown
  /** The error's message, or null when pg-boss kept none. */
  error: string | null
  /** Attempts after the first one. */
  retries: number
  createdAt: Date
  failedAt: Date
}

const NO_QUEUE = 'There is no job queue with that name'
const NO_JOB = 'There is no job with that id in this queue'

function knownQueue(name: string): string {
  if (!QUEUES.some((queue) => queue.name === name)) {
    throw new NotFoundError(NO_QUEUE)
  }
  return name
}

/** Sign-in codes travel sealed in job data, and stay out of sight even so. */
const SECRET_FIELDS = new Set(['code'])

function shownData(data: unknown): unknown {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return data
  }
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => !SECRET_FIELDS.has(key)),
  )
}

// pg-boss stores a thrown error as the error's own fields, and a timeout as
// `{ value: { message } }`.
const failure = z.union([
  z.object({ message: z.string() }),
  z.object({ value: z.object({ message: z.string() }) }),
])

function errorMessage(output: unknown): string | null {
  const parsed = failure.safeParse(output)
  if (!parsed.success) return null
  const message =
    'message' in parsed.data ? parsed.data.message : parsed.data.value.message
  return message.slice(0, 500)
}

const toView = (queue: string, job: FailedJob): FailedJobView => ({
  id: job.id,
  queue,
  data: shownData(job.data),
  error: errorMessage(job.output),
  retries: job.retryCount,
  createdAt: job.createdAt,
  failedAt: job.failedAt,
})

/**
 * Every queue in src/jobs.ts with its counts, in that order. The counts come
 * from pg-boss and can trail by about a minute; the failed jobs themselves
 * are always current.
 */
export async function listJobQueues(
  context: RequestContext,
  queue: JobQueue,
): Promise<QueueCounts[]> {
  assertAdministrator(context)
  const names = QUEUES.map(({ name }) => name)
  const counted = new Map(
    (await queue.counts(names)).map((counts) => [counts.name, counts]),
  )
  return names.map(
    (name) =>
      counted.get(name) ?? {
        name,
        waiting: 0,
        deferred: 0,
        running: 0,
        failed: 0,
      },
  )
}

/** The failed jobs of one queue, the most recent failure first. */
export async function listFailedJobs(
  tx: Transaction,
  context: RequestContext,
  queueName: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<Page<FailedJobView>> {
  assertAdministrator(context)
  const queue = knownQueue(queueName)
  const page = await readFailedJobs(tx, queue, options)
  return { ...page, items: page.items.map((job) => toView(queue, job)) }
}

/** Queues whose failed jobs are never retried from here, and why. */
const NOT_RETRIED_HERE = new Map([
  [
    SEND_EMAIL_QUEUE,
    'Emails are retried from the email list, which also gives them fresh attempts',
  ],
  [
    SEND_SMS_QUEUE,
    'A sign-in code expires within minutes, so it is never sent again; the person asks for a new code instead',
  ],
])

/**
 * Gives a failed job one more attempt and records who did it. The worker
 * picks it up like any other job.
 */
export async function retryFailedJob(
  tx: Transaction,
  context: RequestContext,
  queue: JobQueue,
  queueName: string,
  id: string,
  ip?: string | null,
): Promise<{ id: string; queue: string }> {
  assertAdministrator(context)
  const name = knownQueue(queueName)
  if (!isUuid(id)) throw new NotFoundError(NO_JOB)
  const refusal = NOT_RETRIED_HERE.get(name)
  if (refusal) throw new ConflictError(refusal)
  const job = await queue.findJob(tx, name, id)
  if (!job) throw new NotFoundError(NO_JOB)
  // retry() changes only a job that is still failed, so of two
  // administrators retrying the same job, the second is told so.
  if (job.state !== 'failed' || !(await queue.retry(tx, name, id))) {
    throw new ConflictError(
      'This job has not failed, so there is nothing to retry',
    )
  }
  await recordAuditEntry(tx, {
    actorUserId: context.userId ?? null,
    actorRole: context.role,
    action: 'job.retry',
    entityType: 'job',
    entityId: id,
    before: { queue: name, state: 'failed' },
    after: { queue: name, state: 'retry' },
    ip,
  })
  return { id, queue: name }
}
