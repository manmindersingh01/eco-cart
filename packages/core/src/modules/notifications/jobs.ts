import { and, eq, sql } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import type { Database } from '../../db/client.ts'
import { emailOutbox } from '../../db/schema/index.ts'
import type { EmailSender } from '../../lib/email.ts'
import { openSecret } from '../../lib/encryption.ts'
import type { QueueDefinition } from '../../lib/queue.ts'
import type { SmsSender } from '../../lib/sms.ts'
import {
  renderOrderPlacedEmail,
  renderOtpEmail,
  renderOtpSms,
  renderPaymentReceivedEmail,
} from './templates.ts'
import {
  orderPlacedPayload,
  otpEmailPayload,
  otpSmsJob,
  paymentReceivedPayload,
  sendEmailJob,
} from './types.ts'

export const SEND_EMAIL_QUEUE = 'notifications.send-email'
export const SEND_SMS_QUEUE = 'notifications.send-sms'

/** The first try plus four retries, spaced out with growing delays. */
export const MAX_EMAIL_ATTEMPTS = 5

export const notificationQueues: QueueDefinition[] = [
  {
    name: SEND_EMAIL_QUEUE,
    options: {
      retryLimit: MAX_EMAIL_ATTEMPTS - 1,
      retryDelay: 15,
      retryBackoff: true,
      expireInSeconds: 60,
      deleteAfterSeconds: 24 * 60 * 60,
    },
  },
  {
    // Only sign-in codes travel this way, and they expire in minutes, so a
    // few quick retries are enough and finished jobs are not kept for long.
    name: SEND_SMS_QUEUE,
    options: {
      retryLimit: 2,
      retryDelay: 10,
      retryBackoff: true,
      expireInSeconds: 60,
      deleteAfterSeconds: 60 * 60,
    },
  },
]

export interface NotificationJobDependencies {
  /** Connected as ecokart_worker. */
  db: Database
  emailSender: EmailSender
  /** Null when SMS_PROVIDER=none. */
  smsSender: SmsSender | null
  encryptionKey: Buffer
  now?: () => Date
}

const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 500)

type EmailContent = { text: string; html: string }

/** Renders each template that is not a sign-in code from its payload. */
const RENDERERS: Partial<
  Record<string, (payload: unknown) => EmailContent | null>
> = {
  order_placed: (payload) => {
    const parsed = orderPlacedPayload.safeParse(payload)
    return parsed.success ? renderOrderPlacedEmail(parsed.data) : null
  },
  payment_received: (payload) => {
    const parsed = paymentReceivedPayload.safeParse(payload)
    return parsed.success ? renderPaymentReceivedEmail(parsed.data) : null
  },
}

/**
 * What to send for an outbox row, or why it can never be sent, and the
 * payload to keep afterwards: a sign-in code is removed once the email is
 * sent or given up on.
 */
function prepareEmail(
  row: typeof emailOutbox.$inferSelect,
  deps: NotificationJobDependencies,
  now: Date,
):
  | { content: EmailContent; keep: unknown }
  | { failure: string; keep: unknown } {
  const unrenderable = {
    failure: `The ${row.template} email could not be rendered from its payload`,
    keep: row.payload,
  }
  if (row.template !== 'otp') {
    const content = RENDERERS[row.template]?.(row.payload)
    return content ? { content, keep: row.payload } : unrenderable
  }
  const parsed = otpEmailPayload.safeParse(row.payload)
  if (!parsed.success) return unrenderable
  const payload = parsed.data
  const wiped = { ...payload, code: null }
  if (payload.code === null || new Date(payload.expiresAt) <= now) {
    return { failure: 'The code expired before it could be sent', keep: wiped }
  }
  return {
    content: renderOtpEmail(
      openSecret(payload.code, deps.encryptionKey),
      new Date(payload.expiresAt),
      now,
    ),
    keep: wiped,
  }
}

/**
 * Sends one outbox email. The provider is called outside any transaction,
 * and the row is updated afterwards, only if it is still queued, so a job
 * that runs twice never sends a finished email again. An email that can
 * never be sent, such as an expired code or a payload no template can
 * render, is marked failed at once instead of being retried.
 */
export async function sendQueuedEmail(
  deps: NotificationJobDependencies,
  outboxId: number,
): Promise<void> {
  const now = deps.now?.() ?? new Date()
  const [row] = await deps.db
    .select()
    .from(emailOutbox)
    .where(eq(emailOutbox.id, outboxId))
  if (!row || row.status !== 'queued') return

  const stillQueued = and(
    eq(emailOutbox.id, outboxId),
    eq(emailOutbox.status, 'queued'),
  )
  const prepared = prepareEmail(row, deps, now)
  if ('failure' in prepared) {
    await deps.db
      .update(emailOutbox)
      .set({
        status: 'failed',
        lastError: prepared.failure,
        payload: prepared.keep,
      })
      .where(stillQueued)
    return
  }

  try {
    const { providerMessageId } = await deps.emailSender.send({
      to: row.toEmail,
      subject: row.subject,
      ...prepared.content,
    })
    await deps.db
      .update(emailOutbox)
      .set({
        status: 'sent',
        sentAt: now,
        attempts: sql`${emailOutbox.attempts} + 1`,
        providerMessageId,
        lastError: null,
        payload: prepared.keep,
      })
      .where(stillQueued)
  } catch (error) {
    const giveUp = row.attempts + 1 >= MAX_EMAIL_ATTEMPTS
    await deps.db
      .update(emailOutbox)
      .set({
        attempts: sql`${emailOutbox.attempts} + 1`,
        lastError: errorText(error),
        ...(giveUp ? { status: 'failed', payload: prepared.keep } : {}),
      })
      .where(stillQueued)
    // Throwing hands the job back to pg-boss, which retries it later.
    if (!giveUp) throw error
  }
}

/** Sends one sign-in code by SMS, unless it has already expired. */
export async function sendQueuedSms(
  deps: NotificationJobDependencies,
  data: unknown,
): Promise<void> {
  const now = deps.now?.() ?? new Date()
  const job = otpSmsJob.parse(data)
  const expiresAt = new Date(job.expiresAt)
  if (expiresAt <= now) return
  if (!deps.smsSender) {
    // SMS was switched off after this code was queued; nobody can receive it.
    console.warn('Dropped an SMS because SMS_PROVIDER is none')
    return
  }
  await deps.smsSender.send({
    to: job.to,
    text: renderOtpSms(
      openSecret(job.code, deps.encryptionKey),
      expiresAt,
      now,
    ),
  })
}

/** Called by the worker at startup (apps/worker/src/worker.ts). */
export async function registerNotificationJobs(
  boss: PgBoss,
  deps: NotificationJobDependencies,
): Promise<void> {
  await boss.work(SEND_EMAIL_QUEUE, async ([job]) => {
    if (job) await sendQueuedEmail(deps, sendEmailJob.parse(job.data).outboxId)
  })
  await boss.work(SEND_SMS_QUEUE, async ([job]) => {
    if (job) await sendQueuedSms(deps, job.data)
  })
}
