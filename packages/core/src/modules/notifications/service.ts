import { sql } from 'drizzle-orm'
import type { Transaction } from '../../db/client.ts'
import { emailOutbox } from '../../db/schema/index.ts'
import { sealSecret } from '../../lib/encryption.ts'
import type { JobQueue } from '../../lib/queue.ts'
import { SEND_EMAIL_QUEUE, SEND_SMS_QUEUE } from './jobs.ts'
import { otpEmailSubject } from './templates.ts'
import type {
  EmailOtpPurpose,
  OtpEmailPayload,
  OtpSmsJob,
  SendEmailJob,
} from './types.ts'

export interface OutboxEmail {
  userId?: string | null
  to: string
  template: 'otp'
  subject: string
  payload: Record<string, unknown>
}

/**
 * Phone-only accounts carry a placeholder email under the reserved
 * `.invalid` domain, which must never be mailed.
 */
const isUndeliverable = (address: string) =>
  address.toLowerCase().endsWith('.invalid')

/**
 * Writes an email to the outbox and adds the job that sends it, both inside
 * `tx`, so the email exists exactly when the business change does
 * (design doc 5.13). Returns the outbox id, or null for an address that can
 * never receive mail.
 */
export async function queueEmail(
  tx: Transaction,
  queue: JobQueue,
  email: OutboxEmail,
): Promise<number | null> {
  if (isUndeliverable(email.to)) return null
  // Only administrators may read the outbox, and INSERT ... RETURNING has to
  // pass the read policy too, so the id is reserved first instead.
  const reserved = await tx.execute<{ id: string }>(
    sql`select nextval(pg_get_serial_sequence('email_outbox', 'id')) as id`,
  )
  const id = Number(reserved.rows[0]!.id)
  await tx.insert(emailOutbox).values({
    id,
    userId: email.userId ?? null,
    toEmail: email.to,
    template: email.template,
    subject: email.subject,
    payload: email.payload,
  })
  const job: SendEmailJob = { outboxId: id }
  await queue.send(tx, SEND_EMAIL_QUEUE, job)
  return id
}

export interface OtpMessage {
  code: string
  expiresAt: Date
}

/** Queues a sign-in code email with the code sealed (backend spec step 2). */
export async function queueOtpEmail(
  tx: Transaction,
  queue: JobQueue,
  key: Buffer,
  message: OtpMessage & { email: string; purpose: EmailOtpPurpose },
): Promise<number | null> {
  const payload: OtpEmailPayload = {
    code: sealSecret(message.code, key),
    purpose: message.purpose,
    expiresAt: message.expiresAt.toISOString(),
  }
  return queueEmail(tx, queue, {
    to: message.email,
    template: 'otp',
    subject: otpEmailSubject(message.purpose),
    payload,
  })
}

/** Queues a sign-in code SMS with the code sealed. */
export async function queueOtpSms(
  tx: Transaction,
  queue: JobQueue,
  key: Buffer,
  message: OtpMessage & { phoneNumber: string },
): Promise<void> {
  const job: OtpSmsJob = {
    to: message.phoneNumber,
    code: sealSecret(message.code, key),
    expiresAt: message.expiresAt.toISOString(),
  }
  await queue.send(tx, SEND_SMS_QUEUE, job)
}
