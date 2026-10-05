import { randomBytes } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { withContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import { emailOutbox } from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import type { EmailMessage, EmailSender } from '../../lib/email.ts'
import { sealSecret } from '../../lib/encryption.ts'
import { startJobQueue, type JobQueue } from '../../lib/queue.ts'
import type { SmsMessage, SmsSender } from '../../lib/sms.ts'
import {
  MAX_EMAIL_ATTEMPTS,
  sendQueuedEmail,
  sendQueuedSms,
  type NotificationJobDependencies,
} from './jobs.ts'
import { queueOtpEmail } from './service.ts'

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'notifications-test')
  pools.push(pool)
  return createDatabase(pool)
}
const web = connect(requireEnv('DATABASE_URL'))
const worker = connect(requireEnv('WORKER_DATABASE_URL'))
const key = randomBytes(32)
let queue: JobQueue

beforeAll(async () => {
  queue = await startJobQueue(requireEnv('DATABASE_URL'), 'notifications-test')
})

afterAll(async () => {
  await queue.stop()
  await Promise.all(pools.map((pool) => pool.end()))
})

/** Records what it was asked to send, and can be told to fail. */
function fakeEmailSender(failWith?: Error) {
  const sent: EmailMessage[] = []
  const sender: EmailSender = {
    async send(message) {
      if (failWith) throw failWith
      sent.push(message)
      return { providerMessageId: `fake-${sent.length}` }
    },
  }
  return { sender, sent }
}

const now = new Date('2026-10-05T10:00:00Z')

function depsWith(
  emailSender: EmailSender,
  smsSender: SmsSender | null = null,
): NotificationJobDependencies {
  return {
    db: worker,
    emailSender,
    smsSender,
    encryptionKey: key,
    now: () => now,
  }
}

/** Queues an OTP email the way the sign-in callback does. */
async function queueCode(expiresAt = new Date('2026-10-05T10:05:00Z')) {
  const email = `${crypto.randomUUID()}@example.test`
  const outboxId = await withContext(web, { role: 'anonymous' }, (tx) =>
    queueOtpEmail(tx, queue, key, {
      email,
      code: '482913',
      purpose: 'sign-in',
      expiresAt,
    }),
  )
  return { email, outboxId: outboxId! }
}

const outboxRow = async (id: number) =>
  (await worker.select().from(emailOutbox).where(eq(emailOutbox.id, id)))[0]!

describe('queueOtpEmail', () => {
  test('stores the code encrypted and adds a send job in the same transaction', async () => {
    const { outboxId } = await queueCode()
    const row = await outboxRow(outboxId)
    expect(row).toMatchObject({
      template: 'otp',
      subject: 'Your EcoKart sign-in code',
      status: 'queued',
      attempts: 0,
    })
    expect(JSON.stringify(row.payload)).not.toContain('482913')

    const jobs = await worker.execute(
      sql`select count(*)::int as count from pgboss.job where name = 'notifications.send-email' and (data->>'outboxId')::bigint = ${outboxId}`,
    )
    expect(jobs.rows[0]).toEqual({ count: 1 })
  })

  test('never queues mail to a phone-only placeholder address', async () => {
    const outboxId = await withContext(web, { role: 'anonymous' }, (tx) =>
      queueOtpEmail(tx, queue, key, {
        email: '919812345678@phone.ecokart.invalid',
        code: '482913',
        purpose: 'sign-in',
        expiresAt: new Date('2026-10-05T10:05:00Z'),
      }),
    )
    expect(outboxId).toBeNull()
  })
})

describe('sendQueuedEmail', () => {
  test('sends the code, then marks the email sent and removes the code', async () => {
    const { email, outboxId } = await queueCode()
    const { sender, sent } = fakeEmailSender()

    await sendQueuedEmail(depsWith(sender), outboxId)

    expect(sent).toEqual([
      expect.objectContaining({
        to: email,
        subject: 'Your EcoKart sign-in code',
        text: expect.stringContaining('Your EcoKart code is 482913.'),
      }),
    ])
    const row = await outboxRow(outboxId)
    expect(row).toMatchObject({
      status: 'sent',
      attempts: 1,
      providerMessageId: 'fake-1',
      lastError: null,
      payload: expect.objectContaining({ code: null }),
    })
    expect(row.sentAt).toEqual(now)
  })

  test('does nothing when the job runs again for a sent email', async () => {
    const { outboxId } = await queueCode()
    const { sender, sent } = fakeEmailSender()
    await sendQueuedEmail(depsWith(sender), outboxId)
    await sendQueuedEmail(depsWith(sender), outboxId)
    expect(sent).toHaveLength(1)
  })

  test('does not send a code that has already expired', async () => {
    const { outboxId } = await queueCode(new Date('2026-10-05T09:59:00Z'))
    const { sender, sent } = fakeEmailSender()

    await sendQueuedEmail(depsWith(sender), outboxId)

    expect(sent).toEqual([])
    expect(await outboxRow(outboxId)).toMatchObject({
      status: 'failed',
      lastError: 'The code expired before it could be sent',
      payload: expect.objectContaining({ code: null }),
    })
  })

  test('hands a failure back for a retry, and gives up after the last attempt', async () => {
    const { outboxId } = await queueCode()
    const { sender } = fakeEmailSender(new Error('Provider is down'))

    for (let attempt = 1; attempt < MAX_EMAIL_ATTEMPTS; attempt++) {
      await expect(sendQueuedEmail(depsWith(sender), outboxId)).rejects.toThrow(
        'Provider is down',
      )
      expect(await outboxRow(outboxId)).toMatchObject({
        status: 'queued',
        attempts: attempt,
        lastError: 'Provider is down',
      })
    }

    // The last attempt records the failure instead of asking for a retry.
    await sendQueuedEmail(depsWith(sender), outboxId)
    expect(await outboxRow(outboxId)).toMatchObject({
      status: 'failed',
      attempts: MAX_EMAIL_ATTEMPTS,
      payload: expect.objectContaining({ code: null }),
    })
  })
})

const smsJob = (expiresAt: string) => ({
  to: '+919812345678',
  code: sealSecret('482913', key),
  expiresAt,
})

function fakeSmsSender() {
  const sent: SmsMessage[] = []
  const sender: SmsSender = {
    async send(message) {
      sent.push(message)
      return { providerMessageId: 'fake' }
    },
  }
  return { sender, sent }
}

describe('sendQueuedSms', () => {
  test('sends the code to the number', async () => {
    const { sender, sent } = fakeSmsSender()
    await sendQueuedSms(
      depsWith(fakeEmailSender().sender, sender),
      smsJob('2026-10-05T10:05:00.000Z'),
    )
    expect(sent).toEqual([
      {
        to: '+919812345678',
        text: '482913 is your EcoKart code. It expires in 5 min. Do not share it with anyone.',
      },
    ])
  })

  test('does not send a code that has already expired', async () => {
    const { sender, sent } = fakeSmsSender()
    await sendQueuedSms(
      depsWith(fakeEmailSender().sender, sender),
      smsJob('2026-10-05T09:59:00.000Z'),
    )
    expect(sent).toEqual([])
  })
})
