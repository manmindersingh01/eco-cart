import { createDatabase, createPool, QUEUES, requireEnv } from '@ecokart/core'
import {
  createTestUser,
  startTestWorker,
  type TestWorker,
} from '@ecokart/core/testing'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { closePool } from '@/lib/db'
import { closeJobQueue } from '@/lib/queue'
import { apiRequest } from '@/testing/requests'
import { signInWithEmail } from '@/testing/sign-in'
import { POST as retry } from './[name]/failed-jobs/[id]/retry/route'
import { GET as listFailed } from './[name]/failed-jobs/route'
import { GET } from './route'

const QUEUE = 'invoices.render-pdf'
const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'admin-queues-route-test',
)
const owner = createDatabase(ownerPool)

let worker: TestWorker
let adminCookie: string
let buyerCookie: string

beforeAll(async () => {
  // The web tests have no worker database user, so the owner fails the jobs.
  worker = await startTestWorker(requireEnv('MIGRATION_DATABASE_URL'))
  const admin = await createTestUser(owner, 'admin')
  adminCookie = await signInWithEmail(owner, admin.email)
  buyerCookie = await signInWithEmail(
    owner,
    `${crypto.randomUUID()}@example.test`,
  )
})

afterAll(async () => {
  await worker.stop()
  await closeJobQueue()
  await closePool()
  await ownerPool.end()
})

const failedJob = () =>
  worker.failJob(
    QUEUE,
    { invoiceId: crypto.randomUUID() },
    new Error('Storage was unavailable'),
  )

const get = (cookie?: string) =>
  GET(apiRequest('/admin/queues', cookie ? { cookie } : {}))

const failedJobs = (name: string, cookie = adminCookie) =>
  listFailed(
    apiRequest(`/admin/queues/${name}/failed-jobs?limit=100`, { cookie }),
    {
      params: Promise.resolve({ name }),
    },
  )

const retryJob = (name: string, id: string, cookie = adminCookie) =>
  retry(
    apiRequest(`/admin/queues/${name}/failed-jobs/${id}/retry`, {
      method: 'POST',
      cookie,
    }),
    { params: Promise.resolve({ name, id }) },
  )

describe('GET /api/admin/queues', () => {
  test('lists every queue with its counts for an administrator', async () => {
    const response = await get(adminCookie)
    expect(response.status).toBe(200)
    const { queues } = await response.json()
    expect(queues.map(({ name }: { name: string }) => name)).toEqual(
      QUEUES.map(({ name }) => name),
    )
    expect(queues[0]).toEqual({
      name: QUEUES[0]!.name,
      waiting: expect.any(Number),
      deferred: expect.any(Number),
      running: expect.any(Number),
      failed: expect.any(Number),
    })
  })

  test('answers 401 signed out and 403 for a buyer', async () => {
    expect((await get()).status).toBe(401)
    expect((await get(buyerCookie)).status).toBe(403)
  })
})

describe('failed jobs', () => {
  test('are listed with their error and can be retried once', async () => {
    const id = await failedJob()
    const listed = await failedJobs(QUEUE)
    expect(listed.status).toBe(200)
    expect((await listed.json()).items).toContainEqual({
      id,
      queue: QUEUE,
      data: { invoiceId: expect.any(String) },
      error: 'Storage was unavailable',
      retries: 0,
      createdAt: expect.any(String),
      failedAt: expect.any(String),
    })

    const retried = await retryJob(QUEUE, id)
    expect(retried.status).toBe(200)
    expect(await retried.json()).toEqual({ job: { id, queue: QUEUE } })
    expect((await retryJob(QUEUE, id)).status).toBe(409)
  })

  test('answer 404 for an unknown queue and 403 for a buyer', async () => {
    expect((await failedJobs('nothing.here')).status).toBe(404)
    expect((await failedJobs(QUEUE, buyerCookie)).status).toBe(403)
    const id = await failedJob()
    expect((await retryJob('nothing.here', id)).status).toBe(404)
    expect((await retryJob(QUEUE, id, buyerCookie)).status).toBe(403)
  })
})
