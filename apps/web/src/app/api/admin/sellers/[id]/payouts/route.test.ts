import { createDatabase, createPool, requireEnv } from '@ecokart/core'
import {
  addTestLedgerEntries,
  createTestSeller,
  createTestUser,
} from '@ecokart/core/testing'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { POST as adjust } from '@/app/api/admin/sellers/[id]/adjustments/route'
import { PUT as setBankAccount } from '@/app/api/admin/sellers/[id]/bank-account/route'
import { GET as sellerLedger } from '@/app/api/admin/sellers/[id]/ledger/route'
import { GET as sellerBalances } from '@/app/api/admin/seller-balances/route'
import { GET as ownLedger } from '@/app/api/seller/ledger/route'
import { closePool } from '@/lib/db'
import { apiRequest as request, withId } from '@/testing/requests'
import { signInWithEmail } from '@/testing/sign-in'
import { POST } from './route'

/* The seller ledger, payouts, and adjustments through the API (design doc 5.9). */

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'payouts-route-test',
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
  // Owed ₹1,000: a ₹1,120 sale less ₹120 commission.
  await addTestLedgerEntries(owner, sellerId, [
    { entryType: 'sale', amountPaise: 112_000 },
    { entryType: 'commission', amountPaise: -12_000 },
  ])
  await setBankAccount(
    request(`/admin/sellers/${sellerId}/bank-account`, {
      method: 'PUT',
      cookie: adminCookie,
      body: {
        accountHolder: 'Green Basket Private Limited',
        accountNumber: '50100123456789',
        ifsc: 'HDFC0001234',
      },
    }),
    withId(sellerId),
  )
})

afterAll(async () => {
  await closePool()
  await ownerPool.end()
})

const pay = (body: unknown, cookie = adminCookie) =>
  POST(
    request(`/admin/sellers/${sellerId}/payouts`, {
      method: 'POST',
      ...(cookie ? { cookie } : {}),
      body,
    }),
    withId(sellerId),
  )

describe('/api/admin/sellers/{id}/payouts', () => {
  test('records a payout, which the seller sees in their ledger', async () => {
    const response = await pay({ amountPaise: 60_000, reference: 'UTR90001' })
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      entry: {
        entryType: 'payout',
        amountPaise: -60_000,
        description: 'Payout to account ending 6789 (HDFC0001234)',
        reference: 'UTR90001',
      },
      balancePaise: 40_000,
    })

    const own = await ownLedger(
      request('/seller/ledger', { cookie: sellerCookie }),
    )
    expect(own.status).toBe(200)
    const ledger = await own.json()
    expect(ledger).toMatchObject({ sellerId, balancePaise: 40_000 })
    expect(ledger.items[0]).toMatchObject({ reference: 'UTR90001' })
    const admin = await sellerLedger(
      request(`/admin/sellers/${sellerId}/ledger?limit=1`, {
        cookie: adminCookie,
      }),
      withId(sellerId),
    )
    const page = await admin.json()
    expect(page.items).toHaveLength(1)
    expect(page.nextCursor).toEqual(expect.any(String))
  })

  test('answers a repeated reference with 409 and too much with 400', async () => {
    const twice = await pay({ amountPaise: 1_000, reference: 'utr90001' })
    expect(twice.status).toBe(409)
    expect(await twice.json()).toEqual({
      error:
        'A payout with reference UTR90001 is already recorded for this seller',
    })
    const tooMuch = await pay({ amountPaise: 9_999_999, reference: 'UTR90002' })
    expect(tooMuch.status).toBe(400)
    expect((await tooMuch.json()).issues).toEqual([
      expect.stringMatching(
        /^amountPaise must be at most the seller’s balance of ₹/,
      ),
    ])
  })

  test('is for administrators only', async () => {
    expect(
      (await pay({ amountPaise: 100, reference: 'UTR90003' }, sellerCookie))
        .status,
    ).toBe(403)
    expect(
      (await pay({ amountPaise: 100, reference: 'UTR90003' }, '')).status,
    ).toBe(401)
  })
})

describe('/api/admin/sellers/{id}/adjustments and /api/admin/seller-balances', () => {
  test('an adjustment changes the balance the payout list shows', async () => {
    const response = await adjust(
      request(`/admin/sellers/${sellerId}/adjustments`, {
        method: 'POST',
        cookie: adminCookie,
        body: {
          amountPaise: 2_500,
          reason: 'Delivery charge paid by the seller',
        },
      }),
      withId(sellerId),
    )
    expect(response.status).toBe(201)
    const { balancePaise } = await response.json()

    const found: { sellerId: string; balancePaise: number }[] = []
    let cursor: string | null = null
    do {
      const page: Response = await sellerBalances(
        request(
          `/admin/seller-balances?limit=100${cursor ? `&cursor=${cursor}` : ''}`,
          {
            cookie: adminCookie,
          },
        ),
      )
      const body = await page.json()
      found.push(...body.items)
      cursor = body.nextCursor
    } while (cursor)
    expect(
      found.find((balance) => balance.sellerId === sellerId),
    ).toMatchObject({
      balancePaise,
      bankAccount: { accountNumberLast4: '6789', ifsc: 'HDFC0001234' },
    })
    expect(
      (
        await sellerBalances(
          request('/admin/seller-balances', { cookie: sellerCookie }),
        )
      ).status,
    ).toBe(403)
  })
})
