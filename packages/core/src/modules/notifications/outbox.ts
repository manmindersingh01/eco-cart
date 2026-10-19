import { and, desc, eq, or, sql, type SQL } from 'drizzle-orm'
import type { Transaction } from '../../db/client.ts'
import type { RequestContext } from '../../db/context.ts'
import { emailOutbox } from '../../db/schema/index.ts'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../errors.ts'
import {
  afterLogCursor,
  exactTime,
  logCursor,
  pageSize,
  toPage,
  type Page,
} from '../../lib/pagination.ts'
import type { JobQueue, JobState } from '../../lib/queue.ts'
import { recordAuditEntry } from '../audit/service.ts'
import { SEND_EMAIL_QUEUE } from './jobs.ts'
import type { SendEmailJob } from './types.ts'

/*
 * The administrator's view of emails that did not go out (design doc 5.13).
 * A failed email used up its attempts or could never be sent, such as an
 * expired sign-in code. A stuck email is still queued but has not changed
 * for a long time, because its job was lost: for example, the job failed
 * before it could record anything on the email.
 */

/**
 * Every attempt changes the email, and the longest wait between attempts is
 * a few minutes, so a queued email unchanged for this long is stuck.
 */
export const STUCK_EMAIL_MINUTES = 30

/** `stuck` is a queued email unchanged for STUCK_EMAIL_MINUTES. */
export type EmailState = 'queued' | 'stuck' | 'sent' | 'failed'

export interface OutboxEmailView {
  id: number
  userId: string | null
  to: string
  template: string
  subject: string
  state: EmailState
  attempts: number
  lastError: string | null
  createdAt: Date
  updatedAt: Date
}

type Administrator = Extract<RequestContext, { role: 'admin' | 'system' }>

function assertAdministrator(
  context: RequestContext,
): asserts context is Administrator {
  if (context.role !== 'admin' && context.role !== 'system') {
    throw new ForbiddenError('Only administrators can look after emails')
  }
}

const NO_EMAIL = 'There is no email with that id'

const isFailed = eq(emailOutbox.status, 'failed')
const isStuck = sql`(${emailOutbox.status} = 'queued' and ${emailOutbox.updatedAt} < now() - make_interval(mins => ${STUCK_EMAIL_MINUTES}))`

/** Everything shown of an email: never the payload, which may hold a code. */
const shown = {
  id: emailOutbox.id,
  userId: emailOutbox.userId,
  to: emailOutbox.toEmail,
  template: emailOutbox.template,
  subject: emailOutbox.subject,
  status: emailOutbox.status,
  stuck: sql<boolean>`${isStuck}`,
  attempts: emailOutbox.attempts,
  lastError: emailOutbox.lastError,
  createdAt: emailOutbox.createdAt,
  updatedAt: emailOutbox.updatedAt,
}

interface ShownEmail extends Omit<OutboxEmailView, 'state'> {
  status: string
  stuck: boolean
}

function toView({ status, stuck, ...email }: ShownEmail): OutboxEmailView {
  const state: EmailState =
    status === 'sent' || status === 'failed'
      ? status
      : stuck
        ? 'stuck'
        : 'queued'
  return { ...email, state }
}

/** `state` is failed or stuck; without it, both. */
function stateFilter(state: string | undefined): SQL | undefined {
  if (state === undefined) return or(isFailed, isStuck)
  if (state === 'failed') return isFailed
  if (state === 'stuck') return isStuck
  throw new ValidationError('state must be failed or stuck')
}

/** Emails that failed or are stuck, newest first. Administrators only. */
export async function listUndeliveredEmails(
  tx: Transaction,
  context: RequestContext,
  options: { state?: string; cursor?: string; limit?: number } = {},
): Promise<Page<OutboxEmailView>> {
  assertAdministrator(context)
  const limit = pageSize(options.limit)
  const rows = await tx
    .select({ ...shown, cursorTime: exactTime(emailOutbox.createdAt) })
    .from(emailOutbox)
    .where(
      and(
        stateFilter(options.state),
        options.cursor
          ? afterLogCursor(
              options.cursor,
              emailOutbox.createdAt,
              emailOutbox.id,
            )
          : undefined,
      ),
    )
    .orderBy(desc(emailOutbox.createdAt), desc(emailOutbox.id))
    .limit(limit + 1)
  return toPage(
    rows,
    limit,
    ({ cursorTime: _cursor, ...email }) => toView(email),
    logCursor,
  )
}

/** A job in one of these states will still run. */
const PENDING_STATES = new Set<JobState>(['created', 'retry', 'active'])

/**
 * Puts a failed or stuck email back in the queue with a fresh set of
 * attempts, and records who did it. A sign-in code is never sent again: it
 * has expired by now, and the person asks for a new one instead. An email
 * whose job is still waiting or running is left alone, so it is never sent
 * twice.
 */
export async function retryEmail(
  tx: Transaction,
  context: RequestContext,
  queue: JobQueue,
  id: string,
  ip?: string | null,
): Promise<OutboxEmailView> {
  assertAdministrator(context)
  if (!/^\d{1,15}$/.test(id)) throw new NotFoundError(NO_EMAIL)
  const outboxId = Number(id)
  const [email] = await tx
    .select(shown)
    .from(emailOutbox)
    .where(eq(emailOutbox.id, outboxId))
    .for('update')
  if (!email) throw new NotFoundError(NO_EMAIL)
  if (email.template === 'otp') {
    throw new ConflictError(
      'A sign-in code expires within minutes, so it is never sent again; the person asks for a new code instead',
    )
  }
  if (email.status === 'sent') {
    throw new ConflictError('This email has already been sent')
  }
  const job: SendEmailJob = { outboxId }
  const jobs = await queue.findJobsWithData(tx, SEND_EMAIL_QUEUE, job)
  if (jobs.some(({ state }) => PENDING_STATES.has(state))) {
    throw new ConflictError(
      'This email is still waiting for the worker to send it, so there is nothing to retry yet',
    )
  }

  const [queued] = await tx
    .update(emailOutbox)
    .set({ status: 'queued', attempts: 0 })
    .where(eq(emailOutbox.id, outboxId))
    .returning(shown)
  await queue.send(tx, SEND_EMAIL_QUEUE, job)
  await recordAuditEntry(tx, {
    actorUserId: context.userId ?? null,
    actorRole: context.role,
    action: 'email.retry',
    entityType: 'email',
    entityId: String(outboxId),
    before: {
      status: email.status,
      attempts: email.attempts,
      lastError: email.lastError,
    },
    after: { status: 'queued', attempts: 0 },
    ip,
  })
  return toView(queued!)
}
