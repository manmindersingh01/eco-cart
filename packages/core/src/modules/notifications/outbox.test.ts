import { randomBytes } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import { auditLogs, emailOutbox } from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../errors.ts'
import type { EmailMessage } from '../../lib/email.ts'
import { encodeCursor } from '../../lib/pagination.ts'
import { startJobQueue, type JobQueue } from '../../lib/queue.ts'
import { createTestUser } from '../../testing/fixtures.ts'
import { SEND_EMAIL_QUEUE, sendQueuedEmail } from './jobs.ts'
import {
  listUndeliveredEmails,
  retryEmail,
  type OutboxEmailView,
} from './outbox.ts'
import type { PaymentReceivedPayload } from './types.ts'

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'outbox-test')
  pools.push(pool)
  return createDatabase(pool)
}
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))
const web = connect(requireEnv('DATABASE_URL'))
const worker = connect(requireEnv('WORKER_DATABASE_URL'))
let queue: JobQueue
let admin: Extract<RequestContext, { role: 'admin' }>
let buyer: RequestContext

beforeAll(async () => {
  queue = await startJobQueue(requireEnv('DATABASE_URL'), 'outbox-test')
  admin = { role: 'admin', userId: (await createTestUser(owner, 'admin')).id }
  buyer = { role: 'buyer', userId: (await createTestUser(owner)).id }
})

afterAll(async () => {
  await queue.stop()
  await Promise.all(pools.map((pool) => pool.end()))
})

const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60 * 1000)

const payment: PaymentReceivedPayload = {
  orderNumber: 'EK-2610-00042',
  amountPaise: 129_900,
  method: 'upi',
  paidAt: '2026-10-18T09:30:00.000Z',
}

/** Writes an outbox row the way the worker would have left it. */
async function outboxRow(
  values: Partial<typeof emailOutbox.$inferInsert> = {},
): Promise<number> {
  const [row] = await owner
    .insert(emailOutbox)
    .values({
      toEmail: `${crypto.randomUUID()}@example.test`,
      template: 'payment_received',
      subject: 'Payment received for order EK-2610-00042',
      payload: payment,
      // An email the worker never touched again keeps its first time.
      updatedAt: values.createdAt ?? new Date(),
      ...values,
    })
    .returning({ id: emailOutbox.id })
  return row!.id
}

const list = (
  options: Parameters<typeof listUndeliveredEmails>[2] = {},
  context: RequestContext = admin,
) =>
  withContext(web, context, (tx) => listUndeliveredEmails(tx, context, options))

/** Every page of the list, three emails at a time. */
async function everyPage(state?: string): Promise<OutboxEmailView[]> {
  const shown: OutboxEmailView[] = []
  let cursor: string | undefined
  do {
    const page = await list({
      limit: 3,
      ...(state ? { state } : {}),
      ...(cursor ? { cursor } : {}),
    })
    expect(page.items.length).toBeLessThanOrEqual(3)
    shown.push(...page.items)
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return shown
}

const retry = (id: number | string, context: RequestContext = admin) =>
  withContext(web, context, (tx) =>
    retryEmail(tx, context, queue, String(id), '203.0.113.7'),
  )

/** The states of the send-email jobs for one outbox email. */
async function jobStates(outboxId: number): Promise<string[]> {
  const { rows } = await owner.execute<{ state: string }>(
    sql`select state::text from pgboss.job where name = ${SEND_EMAIL_QUEUE} and data @> ${JSON.stringify({ outboxId })}::jsonb`,
  )
  return rows.map(({ state }) => state)
}

describe('the list of emails that did not go out', () => {
  test('shows failed and stuck emails newest first, a page at a time', async () => {
    const failedOld = await outboxRow({
      status: 'failed',
      attempts: 5,
      lastError: 'Connection refused',
      createdAt: minutesAgo(180),
    })
    const stuck = await outboxRow({ createdAt: minutesAgo(120) })
    // Old, but its last attempt was a moment ago, so it is still on its way.
    const retrying = await outboxRow({
      createdAt: minutesAgo(120),
      updatedAt: minutesAgo(2),
      attempts: 3,
    })
    const sent = await outboxRow({ status: 'sent', createdAt: minutesAgo(90) })
    const queuedNow = await outboxRow()
    const failedNew = await outboxRow({
      status: 'failed',
      lastError: 'The payment_received email could not be rendered',
      createdAt: minutesAgo(1),
    })
    const mine = new Set([
      failedOld,
      stuck,
      retrying,
      sent,
      queuedNow,
      failedNew,
    ])
    const ours = (emails: OutboxEmailView[]) =>
      emails
        .filter(({ id }) => mine.has(id))
        .map(({ id, state }) => [id, state])

    // Other test files queue emails too, so only these are compared.
    expect(ours(await everyPage())).toEqual([
      [failedNew, 'failed'],
      [stuck, 'stuck'],
      [failedOld, 'failed'],
    ])
    expect(ours(await everyPage('failed'))).toEqual([
      [failedNew, 'failed'],
      [failedOld, 'failed'],
    ])
    expect(ours(await everyPage('stuck'))).toEqual([[stuck, 'stuck']])

    const shown = (await everyPage()).find(({ id }) => id === failedOld)
    expect(shown).toEqual({
      id: failedOld,
      userId: null,
      to: expect.stringMatching(/@example\.test$/),
      template: 'payment_received',
      subject: 'Payment received for order EK-2610-00042',
      state: 'failed',
      attempts: 5,
      lastError: 'Connection refused',
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    })
  })

  test('refuses a state or cursor it does not know', async () => {
    await expect(list({ state: 'sent' })).rejects.toThrow(
      new ValidationError('state must be failed or stuck'),
    )
    const uuidCursor = encodeCursor(
      '2026-10-18T10:00:00.000000Z',
      crypto.randomUUID(),
    )
    await expect(list({ cursor: uuidCursor })).rejects.toThrow(
      new ValidationError('That page cursor is not valid'),
    )
  })

  test('is for administrators only', async () => {
    await expect(list({}, buyer)).rejects.toThrow(
      new ForbiddenError('Only administrators can look after emails'),
    )
  })
})

describe('retrying an email', () => {
  test('a failed email goes back in the queue with fresh attempts, then is sent', async () => {
    const id = await outboxRow({
      status: 'failed',
      attempts: 5,
      lastError: 'Connection refused',
    })

    const email = await retry(id)
    expect(email).toMatchObject({ id, state: 'queued', attempts: 0 })
    expect(await jobStates(id)).toEqual(['created'])
    const [audit] = await owner
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, 'email.retry'),
          eq(auditLogs.entityId, `${id}`),
        ),
      )
    expect(audit).toMatchObject({
      actorUserId: admin.userId,
      actorRole: 'admin',
      entityType: 'email',
      before: {
        status: 'failed',
        attempts: 5,
        lastError: 'Connection refused',
      },
      after: { status: 'queued', attempts: 0 },
      ip: '203.0.113.7',
    })

    // Its job is still waiting, so a second retry would send it twice.
    await expect(retry(id)).rejects.toThrow(
      new ConflictError(
        'This email is still waiting for the worker to send it, so there is nothing to retry yet',
      ),
    )

    // The worker sends it like any other email.
    const sent: EmailMessage[] = []
    await sendQueuedEmail(
      {
        db: worker,
        emailSender: {
          async send(message) {
            sent.push(message)
            return { providerMessageId: 'retried-1' }
          },
        },
        smsSender: null,
        encryptionKey: randomBytes(32),
      },
      id,
    )
    expect(sent).toHaveLength(1)
    const [row] = await owner
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.id, id))
    expect(row).toMatchObject({ status: 'sent', attempts: 1, lastError: null })
    await expect(retry(id)).rejects.toThrow(
      new ConflictError('This email has already been sent'),
    )
  })

  test('a stuck email is queued again only when its job is gone', async () => {
    const lost = await outboxRow({ createdAt: minutesAgo(120) })
    expect(await retry(lost)).toMatchObject({ id: lost, state: 'queued' })
    expect(await jobStates(lost)).toEqual(['created'])

    const waiting = await outboxRow({ createdAt: minutesAgo(120) })
    await withContext(web, admin, (tx) =>
      queue.send(tx, SEND_EMAIL_QUEUE, { outboxId: waiting }),
    )
    await expect(retry(waiting)).rejects.toThrow(ConflictError)
    expect(await jobStates(waiting)).toEqual(['created'])
  })

  test('never sends a sign-in code again', async () => {
    const id = await outboxRow({
      template: 'otp',
      subject: 'Your EcoKart sign-in code',
      status: 'failed',
      payload: { code: null, purpose: 'sign-in', expiresAt: minutesAgo(50) },
    })
    await expect(retry(id)).rejects.toThrow(
      new ConflictError(
        'A sign-in code expires within minutes, so it is never sent again; the person asks for a new code instead',
      ),
    )
  })

  test('answers 404 for an email that does not exist', async () => {
    for (const id of ['999999999999', 'abc', '-1', '1e3']) {
      await expect(retry(id)).rejects.toThrow(
        new NotFoundError('There is no email with that id'),
      )
    }
  })

  test('is for administrators only, down to the database', async () => {
    const id = await outboxRow({ status: 'failed' })
    await expect(retry(id, buyer)).rejects.toThrow(ForbiddenError)

    // Row-level security lets only full access change a row, and the grant
    // lets the web app change only the status and attempts.
    const changed = await withContext(web, buyer, (tx) =>
      tx
        .update(emailOutbox)
        .set({ status: 'queued' })
        .where(eq(emailOutbox.id, id))
        .returning({ id: emailOutbox.id }),
    )
    expect(changed).toEqual([])
    await expect(
      withContext(web, admin, (tx) =>
        tx
          .update(emailOutbox)
          .set({ toEmail: 'someone-else@example.test' })
          .where(eq(emailOutbox.id, id)),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } })
  })
})
