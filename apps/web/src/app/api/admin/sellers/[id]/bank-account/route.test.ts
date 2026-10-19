import { createDatabase, createPool, requireEnv, schema } from '@ecokart/core'
import { createTestSeller, createTestUser } from '@ecokart/core/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { GET as ownBankAccount } from '@/app/api/seller/bank-account/route'
import { closePool } from '@/lib/db'
import { apiRequest as request, withId } from '@/testing/requests'
import { signInWithEmail } from '@/testing/sign-in'
import { GET, PUT } from './route'

/* Seller bank accounts through the API (design doc 5.9). */

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'bank-account-route-test',
)
const owner = createDatabase(ownerPool)

let sellerId: string
let sellerCookie: string
let adminCookie: string

beforeAll(async () => {
  const [seller, admin] = await Promise.all([
    createTestSeller(owner),
    createTestUser(owner, 'admin'),
  ])
  sellerId = seller.seller.id
  ;[sellerCookie, adminCookie] = await Promise.all([
    signInWithEmail(owner, seller.owner.email),
    signInWithEmail(owner, admin.email),
  ])
})

afterAll(async () => {
  await closePool()
  await ownerPool.end()
})

const put = (body: unknown, cookie = adminCookie) =>
  PUT(
    request(`/admin/sellers/${sellerId}/bank-account`, {
      method: 'PUT',
      cookie,
      body,
    }),
    withId(sellerId),
  )

const details = {
  accountHolder: 'Green Basket Private Limited',
  accountNumber: '50100123456789',
  ifsc: 'HDFC0001234',
}

describe('/api/admin/sellers/{id}/bank-account', () => {
  test('is empty until an administrator enters the details', async () => {
    const response = await GET(
      request(`/admin/sellers/${sellerId}/bank-account`, {
        cookie: adminCookie,
      }),
      withId(sellerId),
    )
    expect(await response.json()).toEqual({ bankAccount: null })
  })

  test('saves the details and never answers with the full number', async () => {
    const response = await put(details)
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).not.toContain('50100123456789')
    expect(JSON.parse(body)).toMatchObject({
      bankAccount: { accountNumberLast4: '6789', ifsc: 'HDFC0001234' },
    })
    const [row] = await owner
      .select()
      .from(schema.sellerBankAccounts)
      .where(eq(schema.sellerBankAccounts.sellerId, sellerId))
    expect(row!.accountNumberSealed).not.toContain('50100123456789')
  })

  test('the seller sees the last 4 digits but cannot change them', async () => {
    const own = await ownBankAccount(
      request('/seller/bank-account', { cookie: sellerCookie }),
    )
    expect(await own.json()).toMatchObject({
      bankAccount: {
        accountHolder: 'Green Basket Private Limited',
        accountNumberLast4: '6789',
      },
    })
    expect((await put(details, sellerCookie)).status).toBe(403)
  })

  test('answers bad details with plain messages', async () => {
    const response = await put({ ...details, ifsc: 'HDFC1234' })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Those bank details are not valid',
      issues: ['ifsc must be an IFSC of 11 characters, such as HDFC0001234'],
    })
  })
})
