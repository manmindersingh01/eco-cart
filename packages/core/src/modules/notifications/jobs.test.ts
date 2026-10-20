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

/** An order email in the outbox, as checkout queues it. */
async function queueOrderEmail(
  payload: Record<string, unknown>,
  template:
    | 'order_placed'
    | 'payment_received'
    | 'dispatched'
    | 'cancelled'
    | 'refund_recorded' = 'order_placed',
) {
  const [row] = await worker
    .insert(emailOutbox)
    .values({
      toEmail: `${crypto.randomUUID()}@example.test`,
      template,
      subject:
        template === 'order_placed'
          ? 'Your EcoKart order EK-261018-000001 is placed'
          : `An EcoKart ${template} email`,
      payload,
    })
    .returning()
  return row!
}

describe('emails other than sign-in codes', () => {
  const orderPlaced = {
    orderNumber: 'EK-261018-000001',
    buyerName: 'Asha Patil',
    placedAt: '2026-10-18T09:30:00.000Z',
    paymentMethod: 'cod',
    lines: [
      {
        title: 'Bamboo Drinking Straw',
        options: { Pack: '10' },
        quantity: 5,
        lineTotalPaise: 25_000,
      },
    ],
    subtotalPaise: 25_000,
    discountPaise: 0,
    deliveryPaise: 4_900,
    totalPaise: 29_900,
    shippingAddress: {
      fullName: 'Asha Patil',
      phone: '+919812345678',
      line1: '4 FC Road',
      line2: null,
      landmark: null,
      city: 'Pune',
      stateCode: '27',
      pincode: '411004',
    },
  }

  test('sends an order email and marks it sent', async () => {
    const { sender, sent } = fakeEmailSender()
    const row = await queueOrderEmail(orderPlaced)
    await sendQueuedEmail(depsWith(sender), row.id)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      to: row.toEmail,
      subject: 'Your EcoKart order EK-261018-000001 is placed',
    })
    expect(sent[0]!.text).toContain('Bamboo Drinking Straw (10) × 5')
    expect(sent[0]!.text).toContain('Total: ₹299')
    expect(sent[0]!.text).toContain(
      'Delivering to:\nAsha Patil\n4 FC Road\nPune, Maharashtra 411004\nPhone: +919812345678',
    )
    expect(await outboxRow(row.id)).toMatchObject({
      status: 'sent',
      attempts: 1,
    })
  })

  test('names the payment method the way a buyer would', async () => {
    const { sender, sent } = fakeEmailSender()
    const row = await queueOrderEmail(
      {
        orderNumber: 'EK-261018-000002',
        amountPaise: 24_800,
        method: 'upi',
        paidAt: '2026-10-18T09:30:00.000Z',
      },
      'payment_received',
    )
    await sendQueuedEmail(depsWith(sender), row.id)
    expect(sent[0]!.text).toBe(
      'We have received your payment of ₹248 for order EK-261018-000002 on 18 Oct 2026 by UPI.\n\nYour invoice will be ready to download from your order shortly.',
    )
  })

  test('sends the dispatched and cancelled emails', async () => {
    const { sender, sent } = fakeEmailSender()
    const line = { title: 'Bamboo Toothbrush', options: {}, quantity: 2 }
    const dispatched = await queueOrderEmail(
      {
        orderNumber: 'EK-261018-000003',
        buyerName: 'Asha Patil',
        lines: [line],
        courierName: 'Delhivery',
        trackingNumber: 'DLV1234567',
        trackingUrl: 'https://www.delhivery.com/track/DLV1234567',
        wholeOrder: false,
        firstParcel: true,
      },
      'dispatched',
    )
    const cancelled = await queueOrderEmail(
      {
        orderNumber: 'EK-261018-000004',
        buyerName: 'Asha Patil',
        placedAt: '2026-10-18T09:30:00.000Z',
        cancelledBy: 'ecokart',
        reason: 'The seller cannot supply it',
        lines: [line],
        money: { kind: 'refund', amountPaise: 39_800 },
      },
      'cancelled',
    )
    await sendQueuedEmail(depsWith(sender), dispatched.id)
    await sendQueuedEmail(depsWith(sender), cancelled.id)
    expect(sent.map((email) => email.text)).toEqual([
      'Hello Asha Patil,\n\nPart of your order EK-261018-000003 is on its way. We will email you again when the rest is dispatched.\n\nBamboo Toothbrush × 2\n\nCourier: Delhivery\nTracking number: DLV1234567\nTrack it: https://www.delhivery.com/track/DLV1234567\n\nThank you for shopping with EcoKart.',
      'Hello Asha Patil,\n\nWe are sorry: your order EK-261018-000004, placed on 18 Oct 2026, has been cancelled. Reason: The seller cannot supply it\n\nBamboo Toothbrush × 2\n\nWe will refund ₹398 to the way you paid, and email you when the refund is made.',
    ])
  })

  test('sends the refund recorded email', async () => {
    const { sender, sent } = fakeEmailSender()
    const row = await queueOrderEmail(
      {
        orderNumber: 'EK-261020-000007',
        buyerName: 'Asha Patil',
        amountPaise: 50_000,
        method: 'gateway',
        lines: [{ title: 'Bamboo Toothbrush', options: {}, quantity: 1 }],
      },
      'refund_recorded',
    )
    await sendQueuedEmail(depsWith(sender), row.id)
    expect(sent[0]!.text).toBe(
      'Hello Asha Patil,\n\nWe have refunded ₹500 for order EK-261020-000007.\n\nFor your return of:\nBamboo Toothbrush × 1\n\nIt goes back the way you paid. Your bank may take a few working days to show it.\n\nThank you for shopping with EcoKart.',
    )
  })

  test('gives up at once on an email no template can render', async () => {
    const { sender, sent } = fakeEmailSender()
    const row = await queueOrderEmail({ orderNumber: 42 })
    await sendQueuedEmail(depsWith(sender), row.id)
    expect(sent).toEqual([])
    expect(await outboxRow(row.id)).toMatchObject({
      status: 'failed',
      lastError:
        'The order_placed email could not be rendered from its payload',
    })
  })
})
