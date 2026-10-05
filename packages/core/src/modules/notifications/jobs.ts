import { and, eq, sql } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import type { Database } from '../../db/client.ts'
import { emailOutbox } from '../../db/schema/index.ts'
import type { EmailSender } from '../../lib/email.ts'
import { openSecret } from '../../lib/encryption.ts'
import type { QueueDefinition } from '../../lib/queue.ts'
import type { SmsSender } from '../../lib/sms.ts'
import { renderOtpEmail, renderOtpSms } from './templates.ts'
import { otpEmailPayload, otpSmsJob, sendEmailJob } from './types.ts'

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

/**
 * Sends one outbox email. The provider is called outside any transaction,
 * and the row is updated afterwards, only if it is still queued, so a job
 * that runs twice never sends a finished email again.
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
  const payload = otpEmailPayload.parse(row.payload)
  // The code is removed once the email is sent or given up on.
  const wipedPayload = { ...payload, code: null }

  if (payload.code === null || new Date(payload.expiresAt) <= now) {
    await deps.db
      .update(emailOutbox)
      .set({
        status: 'failed',
        lastError: 'The code expired before it could be sent',
        payload: wipedPayload,
      })
      .where(stillQueued)
    return
  }

  const content = renderOtpEmail(
    openSecret(payload.code, deps.encryptionKey),
    new Date(payload.expiresAt),
    now,
  )
  try {
    const { providerMessageId } = await deps.emailSender.send({
      to: row.toEmail,
      subject: row.subject,
      ...content,
    })
    await deps.db
      .update(emailOutbox)
      .set({
        status: 'sent',
        sentAt: now,
        attempts: sql`${emailOutbox.attempts} + 1`,
        providerMessageId,
        lastError: null,
        payload: wipedPayload,
      })
      .where(stillQueued)
  } catch (error) {
    const giveUp = row.attempts + 1 >= MAX_EMAIL_ATTEMPTS
    await deps.db
      .update(emailOutbox)
      .set({
        attempts: sql`${emailOutbox.attempts} + 1`,
        lastError: errorText(error),
        ...(giveUp ? { status: 'failed', payload: wipedPayload } : {}),
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
