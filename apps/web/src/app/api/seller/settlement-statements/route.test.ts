import {
  createDatabase,
  createObjectStorage,
  createPool,
  loadStorageConfig,
  makeSettlementStatement,
  requireEnv,
} from '@ecokart/core'
import {
  addTestLedgerEntries,
  createTestSeller,
  createTestUser,
} from '@ecokart/core/testing'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  GET as sellerStatements,
  POST as askForSeller,
} from '@/app/api/admin/sellers/[id]/settlement-statements/route'
import { GET as openFile } from '@/app/api/settlement-statements/[id]/file/route'
import { GET as readStatement } from '@/app/api/settlement-statements/[id]/route'
import { closePool } from '@/lib/db'
import { closeJobQueue } from '@/lib/queue'
import { apiRequest as request, withId } from '@/testing/requests'
import { signInWithEmail } from '@/testing/sign-in'
import { GET, POST } from './route'

/*
 * Settlement statements through the API (design doc 5.9). The worker's job
 * is called directly.
 */

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'statements-route-test',
)
const owner = createDatabase(ownerPool)
const storage = createObjectStorage(loadStorageConfig())

let sellerId: string
let sellerCookie: string
let otherSellerCookie: string
let adminCookie: string

beforeAll(async () => {
  const [seller, other, admin] = await Promise.all([
    createTestSeller(owner),
    createTestSeller(owner),
    createTestUser(owner, 'admin'),
  ])
  sellerId = seller.seller.id
  ;[sellerCookie, otherSellerCookie, adminCookie] = await Promise.all([
    signInWithEmail(owner, seller.owner.email),
    signInWithEmail(owner, other.owner.email),
    signInWithEmail(owner, admin.email),
  ])
  await addTestLedgerEntries(owner, sellerId, [
    {
      entryType: 'sale',
      amountPaise: 50_000,
      description: 'Sale of 1 × Bamboo bottle',
      createdAt: new Date('2026-10-02T10:00:00+05:30'),
    },
  ])
})

afterAll(async () => {
  await closeJobQueue()
  await closePool()
  await ownerPool.end()
})

const statementStatus = async (id: string, cookie: string) =>
  readStatement(request(`/settlement-statements/${id}`, { cookie }), withId(id))

describe('/api/seller/settlement-statements', () => {
  test('the seller asks, the worker makes it, and the seller downloads it', async () => {
    const asked = await POST(
      request('/seller/settlement-statements', {
        method: 'POST',
        cookie: sellerCookie,
        body: { from: '2026-10-01', to: '2026-10-05' },
      }),
    )
    expect(asked.status).toBe(202)
    const { statement } = await asked.json()
    expect(statement).toMatchObject({
      status: 'processing',
      from: '2026-10-01',
    })
    const early = await openFile(
      request(`/settlement-statements/${statement.id}/file`, {
        cookie: sellerCookie,
      }),
      withId(statement.id),
    )
    expect(early.status).toBe(409)

    await makeSettlementStatement({ db: owner, storage }, statement.id)
    const made = await statementStatus(statement.id, sellerCookie)
    expect((await made.json()).statement).toMatchObject({
      status: 'ready',
      openingBalancePaise: 0,
      closingBalancePaise: 50_000,
      entryCount: 1,
    })
    const link = await openFile(
      request(`/settlement-statements/${statement.id}/file`, {
        cookie: sellerCookie,
      }),
      withId(statement.id),
    )
    expect(link.status).toBe(302)
    expect(link.headers.get('cache-control')).toBe('no-store')
    const csv = await (await fetch(link.headers.get('location')!)).text()
    expect(csv).toContain(
      '"Sale","Sale of 1 × Bamboo bottle","","","500.00","500.00"',
    )

    const list = await GET(
      request('/seller/settlement-statements', { cookie: sellerCookie }),
    )
    expect((await list.json()).items[0].id).toBe(statement.id)
    // Another seller cannot even tell it exists.
    expect(
      (await statementStatus(statement.id, otherSellerCookie)).status,
    ).toBe(404)
  })

  test('answers a bad period with plain messages', async () => {
    const response = await POST(
      request('/seller/settlement-statements', {
        method: 'POST',
        cookie: sellerCookie,
        body: { from: '2026-10-05', to: '2026-10-01' },
      }),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'That statement cannot be made',
      issues: ['from must not be after to'],
    })
  })
})

describe('/api/admin/sellers/{id}/settlement-statements', () => {
  test('administrators ask for and list a seller’s statements', async () => {
    const asked = await askForSeller(
      request(`/admin/sellers/${sellerId}/settlement-statements`, {
        method: 'POST',
        cookie: adminCookie,
        body: { from: '2026-09-01', to: '2026-09-30' },
      }),
      withId(sellerId),
    )
    expect(asked.status).toBe(202)
    const { statement } = await asked.json()
    const list = await sellerStatements(
      request(`/admin/sellers/${sellerId}/settlement-statements`, {
        cookie: adminCookie,
      }),
      withId(sellerId),
    )
    expect((await list.json()).items[0].id).toBe(statement.id)
    const refused = await askForSeller(
      request(`/admin/sellers/${sellerId}/settlement-statements`, {
        method: 'POST',
        cookie: sellerCookie,
        body: { from: '2026-09-01', to: '2026-09-30' },
      }),
      withId(sellerId),
    )
    expect(refused.status).toBe(403)
  })
})
