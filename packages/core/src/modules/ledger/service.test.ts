import { randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import { auditLogs, sellerBankAccounts } from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import { ForbiddenError, NotFoundError } from '../../errors.ts'
import { openSecret } from '../../lib/encryption.ts'
import { validationIssues } from '../../testing/errors.ts'
import { createTestSeller, createTestUser } from '../../testing/fixtures.ts'
import {
  getOwnBankAccount,
  getSellerBankAccount,
  readPayoutBankAccount,
  setSellerBankAccount,
} from './service.ts'

/* Seller bank accounts (design doc 5.9) against the real database. */

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'ledger-test')
  pools.push(pool)
  return createDatabase(pool)
}
const web = connect(requireEnv('DATABASE_URL'))
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))
const key = randomBytes(32)
let admin: Extract<RequestContext, { role: 'admin' }>

beforeAll(async () => {
  admin = { role: 'admin', userId: (await createTestUser(owner, 'admin')).id }
})

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()))
})

const details = {
  accountHolder: 'Green Basket Private Limited',
  accountNumber: '5010 0123 4567 89',
  ifsc: 'hdfc0001234',
}

const set = (
  sellerId: string,
  input: unknown,
  context: RequestContext = admin,
) =>
  withContext(web, context, (tx) =>
    setSellerBankAccount(tx, key, context, sellerId, input, '203.0.113.4'),
  )

async function storedRow(sellerId: string) {
  const [row] = await owner
    .select()
    .from(sellerBankAccounts)
    .where(eq(sellerBankAccounts.sellerId, sellerId))
  return row
}

const auditFor = (sellerId: string) =>
  owner
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, 'seller.bank_account.set'),
        eq(auditLogs.entityId, sellerId),
      ),
    )
    .orderBy(auditLogs.id)

describe('setSellerBankAccount', () => {
  test('seals the account number and shows only its last 4 digits', async () => {
    const { seller } = await createTestSeller(owner, 'pending')
    const view = await set(seller.id, details)
    expect(view).toEqual({
      sellerId: seller.id,
      accountHolder: 'Green Basket Private Limited',
      accountNumberLast4: '6789',
      ifsc: 'HDFC0001234',
      updatedAt: expect.any(Date),
    })
    expect(JSON.stringify(view)).not.toContain('501001234567')

    const row = await storedRow(seller.id)
    expect(row!.accountNumberSealed).toMatch(/^v1\./)
    expect(row!.accountNumberSealed).not.toContain('501001234567')
    expect(openSecret(row!.accountNumberSealed, key)).toBe('50100123456789')
    expect(row!.updatedBy).toBe(admin.userId)
  })

  test('replaces the details and audits them without the number', async () => {
    const { seller } = await createTestSeller(owner, 'approved')
    await set(seller.id, details)
    await set(seller.id, { ...details, accountHolder: 'Green Basket Pvt Ltd' })
    await set(seller.id, {
      ...details,
      accountNumber: '000123456780',
      ifsc: 'SBIN0004321',
    })
    const entries = await auditFor(seller.id)
    expect(entries.map((entry) => entry.after)).toEqual([
      {
        accountHolder: 'Green Basket Private Limited',
        accountNumberLast4: '6789',
        ifsc: 'HDFC0001234',
        accountNumberChanged: true,
      },
      {
        accountHolder: 'Green Basket Pvt Ltd',
        accountNumberLast4: '6789',
        ifsc: 'HDFC0001234',
        accountNumberChanged: false,
      },
      {
        accountHolder: 'Green Basket Private Limited',
        accountNumberLast4: '6780',
        ifsc: 'SBIN0004321',
        accountNumberChanged: true,
      },
    ])
    expect(entries[0]).toMatchObject({
      actorUserId: admin.userId,
      actorRole: 'admin',
      entityType: 'seller',
      before: null,
      ip: '203.0.113.4',
    })
    expect(entries[2]!.before).toEqual({
      accountHolder: 'Green Basket Pvt Ltd',
      accountNumberLast4: '6789',
      ifsc: 'HDFC0001234',
    })
    expect(JSON.stringify(entries)).not.toMatch(/0001234567|501001234567/)
    expect(
      await owner
        .select()
        .from(sellerBankAccounts)
        .where(eq(sellerBankAccounts.sellerId, seller.id)),
    ).toHaveLength(1)
  })

  test('says plainly what is wrong', async () => {
    const { seller } = await createTestSeller(owner, 'pending')
    expect(
      await validationIssues(
        set(seller.id, {
          accountHolder: ' ',
          accountNumber: '12-34',
          ifsc: 'HDFC1234',
          branch: 'MG Road',
        }),
      ),
    ).toEqual([
      'accountHolder must not be empty',
      'accountNumber must be 9 to 18 digits',
      'ifsc must be an IFSC of 11 characters, such as HDFC0001234',
      'branch is not allowed here',
    ])
  })

  test('only administrators, and only for a seller that exists', async () => {
    const { owner: user, seller } = await createTestSeller(owner, 'approved')
    const sellerContext: RequestContext = {
      role: 'seller',
      userId: user.id,
      sellerId: seller.id,
    }
    await expect(set(seller.id, details, sellerContext)).rejects.toThrow(
      ForbiddenError,
    )
    await expect(set(crypto.randomUUID(), details)).rejects.toThrow(
      NotFoundError,
    )
    await expect(set('not-an-id', details)).rejects.toThrow(NotFoundError)
    expect(await storedRow(seller.id)).toBeUndefined()
  })
})

describe('reading bank details', () => {
  test('administrators and the seller see the last 4 digits; others nothing', async () => {
    const { owner: user, seller } = await createTestSeller(owner, 'approved')
    const sellerContext: RequestContext = {
      role: 'seller',
      userId: user.id,
      sellerId: seller.id,
    }
    const own = () =>
      withContext(web, sellerContext, (tx) =>
        getOwnBankAccount(tx, sellerContext),
      )
    const forAdmin = () =>
      withContext(web, admin, (tx) =>
        getSellerBankAccount(tx, admin, seller.id),
      )
    expect(await own()).toBeNull()
    expect(await forAdmin()).toBeNull()

    await set(seller.id, details)
    expect(await own()).toMatchObject({ accountNumberLast4: '6789' })
    expect(await forAdmin()).toMatchObject({
      accountHolder: 'Green Basket Private Limited',
      accountNumberLast4: '6789',
    })

    const buyer: RequestContext = {
      role: 'buyer',
      userId: (await createTestUser(owner, 'buyer')).id,
    }
    await expect(
      withContext(web, buyer, (tx) => getOwnBankAccount(tx, buyer)),
    ).rejects.toThrow(ForbiddenError)
    await expect(
      withContext(web, sellerContext, (tx) =>
        getSellerBankAccount(tx, sellerContext, seller.id),
      ),
    ).rejects.toThrow(ForbiddenError)
  })

  test('a payout reads the full number, with the right key only', async () => {
    const { seller } = await createTestSeller(owner, 'approved')
    await set(seller.id, details)
    const payout = (context: RequestContext, withKey = key) =>
      withContext(web, context, (tx) =>
        readPayoutBankAccount(tx, withKey, context, seller.id),
      )
    expect(await payout({ role: 'system' })).toEqual({
      accountHolder: 'Green Basket Private Limited',
      accountNumber: '50100123456789',
      ifsc: 'HDFC0001234',
    })
    await expect(payout(admin, randomBytes(32))).rejects.toThrow(
      'unable to authenticate data',
    )
    const { seller: other } = await createTestSeller(owner, 'approved')
    expect(
      await withContext(web, admin, (tx) =>
        readPayoutBankAccount(tx, key, admin, other.id),
      ),
    ).toBeNull()
  })
})
