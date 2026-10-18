import { createDatabase, createPool, requireEnv, schema } from '@ecokart/core'
import { createTestUser } from '@ecokart/core/testing'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { closePool } from '@/lib/db'
import { closeJobQueue } from '@/lib/queue'
import { apiRequest, withId } from '@/testing/requests'
import { signInWithEmail } from '@/testing/sign-in'
import { POST as retry } from './[id]/retry/route'
import { GET } from './route'

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'admin-emails-route-test',
)
const owner = createDatabase(ownerPool)

let adminCookie: string
let buyerCookie: string

beforeAll(async () => {
  const admin = await createTestUser(owner, 'admin')
  adminCookie = await signInWithEmail(owner, admin.email)
  buyerCookie = await signInWithEmail(
    owner,
    `${crypto.randomUUID()}@example.test`,
  )
})

afterAll(async () => {
  await closeJobQueue()
  await closePool()
  await ownerPool.end()
})

async function failedEmail(template: 'payment_received' | 'otp') {
  const [row] = await owner
    .insert(schema.emailOutbox)
    .values({
      toEmail: `${crypto.randomUUID()}@example.test`,
      template,
      subject: 'Payment received for order EK-2610-00042',
      payload: {
        orderNumber: 'EK-2610-00042',
        amountPaise: 129_900,
        method: 'upi',
        paidAt: '2026-10-18T09:30:00.000Z',
      },
      status: 'failed',
      attempts: 5,
      lastError: 'Connection refused',
    })
    .returning({ id: schema.emailOutbox.id })
  return row!.id
}

const list = (query: string, cookie?: string) =>
  GET(apiRequest(`/admin/emails${query}`, cookie ? { cookie } : {}))

const retryEmail = (id: number | string, cookie = adminCookie) =>
  retry(
    apiRequest(`/admin/emails/${id}/retry`, { method: 'POST', cookie }),
    withId(String(id)),
  )

describe('GET /api/admin/emails', () => {
  test('lists failed emails for an administrator', async () => {
    const id = await failedEmail('payment_received')
    const response = await list('?state=failed&limit=100', adminCookie)
    expect(response.status).toBe(200)
    const page = await response.json()
    expect(page.items).toContainEqual({
      id,
      userId: null,
      to: expect.stringMatching(/@example\.test$/),
      template: 'payment_received',
      subject: 'Payment received for order EK-2610-00042',
      state: 'failed',
      attempts: 5,
      lastError: 'Connection refused',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })
  })

  test('answers 400 for an unknown state, 401 signed out, and 403 for a buyer', async () => {
    const unknown = await list('?state=sent', adminCookie)
    expect(unknown.status).toBe(400)
    expect(await unknown.json()).toMatchObject({
      error: 'state must be failed or stuck',
    })
    expect((await list('')).status).toBe(401)
    expect((await list('', buyerCookie)).status).toBe(403)
  })
})

describe('POST /api/admin/emails/[id]/retry', () => {
  test('puts a failed email back in the queue once', async () => {
    const id = await failedEmail('payment_received')
    const response = await retryEmail(id)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      email: { id, state: 'queued', attempts: 0 },
    })
    const again = await retryEmail(id)
    expect(again.status).toBe(409)
  })

  test('refuses a sign-in code, an unknown email, and a buyer', async () => {
    expect((await retryEmail(await failedEmail('otp'))).status).toBe(409)
    expect((await retryEmail('999999999999')).status).toBe(404)
    const id = await failedEmail('payment_received')
    expect((await retryEmail(id, buyerCookie)).status).toBe(403)
  })
})
