import { randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import { auditLogs, sellerBankAccounts } from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../errors.ts'
import { rejectionOf, validationIssues } from '../../testing/errors.ts'
import {
  addTestLedgerEntries,
  createTestSeller,
  createTestUser,
} from '../../testing/fixtures.ts'
import { holdRows, sessionsWaitingOn, waitUntil } from '../../testing/locks.ts'
import { setSellerBankAccount } from './bank-accounts.ts'
import { getOwnLedger, getSellerLedger, listSellerBalances } from './entries.ts'
import { recordAdjustment, recordPayout } from './payouts.ts'
import type { SellerBalance } from './types.ts'

/*
 * The seller ledger (design doc 5.9) against the real database: reading it,
 * balances, payouts, and adjustments.
 */

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'ledger-entries-test')
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

type TestSeller = Awaited<ReturnType<typeof createTestSeller>>

const sellerContext = ({ owner: user, seller }: TestSeller) =>
  ({
    role: 'seller',
    userId: user.id,
    sellerId: seller.id,
  }) satisfies RequestContext

const asAdmin = <T>(work: Parameters<typeof withContext<T>>[2]) =>
  withContext(web, admin, work)

/** A seller owed ₹1,000: a ₹1,120 sale less ₹120 commission. */
async function sellerOwed(): Promise<TestSeller> {
  const seller = await createTestSeller(owner)
  await addTestLedgerEntries(owner, seller.seller.id, [
    { entryType: 'sale', amountPaise: 112_000 },
    { entryType: 'commission', amountPaise: -12_000 },
  ])
  return seller
}

async function withBankAccount(seller: TestSeller): Promise<TestSeller> {
  await asAdmin((tx) =>
    setSellerBankAccount(tx, key, admin, seller.seller.id, {
      accountHolder: 'Green Basket Private Limited',
      accountNumber: '50100123456789',
      ifsc: 'HDFC0001234',
    }),
  )
  return seller
}

const pay = (
  sellerId: string,
  input: unknown,
  context: RequestContext = admin,
) =>
  withContext(web, context, (tx) =>
    recordPayout(tx, context, sellerId, input, '203.0.113.4'),
  )

const adjust = (
  sellerId: string,
  input: unknown,
  context: RequestContext = admin,
) =>
  withContext(web, context, (tx) =>
    recordAdjustment(tx, context, sellerId, input, '203.0.113.4'),
  )

const auditFor = (sellerId: string, action: string) =>
  owner
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, action), eq(auditLogs.entityId, sellerId)))
    .orderBy(auditLogs.id)

/** A time in October 2026, India time: `at('2T10:00:00')`. */
const at = (time: string) => new Date(`2026-10-0${time}+05:30`)

/** Every page of the list, `limit` at a time. */
async function allBalances(limit: number): Promise<SellerBalance[]> {
  const all: SellerBalance[] = []
  let cursor: string | undefined
  do {
    const page = await asAdmin((tx) =>
      listSellerBalances(tx, admin, { limit, ...(cursor ? { cursor } : {}) }),
    )
    all.push(...page.items)
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return all
}

describe('reading the ledger', () => {
  test('a seller reads their own ledger newest first, with the balance', async () => {
    const seller = await createTestSeller(owner)
    await addTestLedgerEntries(owner, seller.seller.id, [
      { entryType: 'sale', amountPaise: 50_000, createdAt: at('1T09:00:00') },
      {
        entryType: 'adjustment',
        amountPaise: -500,
        createdAt: at('3T09:00:00'),
      },
    ])
    // Three entries at the same microsecond, told apart by id.
    const same = await addTestLedgerEntries(owner, seller.seller.id, [
      { entryType: 'sale', amountPaise: 30_000, createdAt: at('2T10:00:00') },
      {
        entryType: 'commission',
        amountPaise: -3_000,
        createdAt: at('2T10:00:00'),
      },
      { entryType: 'sale', amountPaise: 20_000, createdAt: at('2T10:00:00') },
    ])
    const context = sellerContext(seller)
    const read = (cursor?: string) =>
      withContext(web, context, (tx) =>
        getOwnLedger(tx, context, { limit: 2, ...(cursor ? { cursor } : {}) }),
      )

    const first = await read()
    expect(first.sellerId).toBe(seller.seller.id)
    expect(first.balancePaise).toBe(96_500)
    expect(first.items.map((entry) => entry.amountPaise)).toEqual([
      -500, 20_000,
    ])
    expect(first.items[1]).toEqual({
      id: same[2]!.id,
      entryType: 'sale',
      amountPaise: 20_000,
      description: 'Test sale',
      reference: null,
      orderId: null,
      orderItemId: null,
      returnRequestId: null,
      createdAt: at('2T10:00:00'),
    })
    const second = await read(first.nextCursor!)
    expect(second.items.map((entry) => entry.amountPaise)).toEqual([
      -3_000, 30_000,
    ])
    const third = await read(second.nextCursor!)
    expect(third.items.map((entry) => entry.amountPaise)).toEqual([50_000])
    expect(third.nextCursor).toBeNull()
  })

  test('administrators read any seller’s ledger; sellers only their own', async () => {
    const seller = await sellerOwed()
    const other = await sellerOwed()
    const ledger = await asAdmin((tx) =>
      getSellerLedger(tx, admin, seller.seller.id),
    )
    expect(ledger.balancePaise).toBe(100_000)
    expect(ledger.items).toHaveLength(2)

    const context = sellerContext(other)
    await expect(
      withContext(web, context, (tx) =>
        getSellerLedger(tx, context, seller.seller.id),
      ),
    ).rejects.toThrow(ForbiddenError)
    const buyer: RequestContext = {
      role: 'buyer',
      userId: (await createTestUser(owner)).id,
    }
    await expect(
      withContext(web, buyer, (tx) => getOwnLedger(tx, buyer)),
    ).rejects.toThrow(ForbiddenError)
    await expect(
      asAdmin((tx) => getSellerLedger(tx, admin, crypto.randomUUID())),
    ).rejects.toThrow(NotFoundError)
    await expect(
      asAdmin((tx) =>
        getSellerLedger(tx, admin, seller.seller.id, { cursor: 'nonsense' }),
      ),
    ).rejects.toThrow(ValidationError)
  })
})

describe('seller balances', () => {
  test('lists the sellers with money to settle, largest first', async () => {
    const owed = await withBankAccount(await sellerOwed())
    const owedMore = await createTestSeller(owner)
    await addTestLedgerEntries(owner, owedMore.seller.id, [
      { entryType: 'sale', amountPaise: 250_000 },
    ])
    const settled = await createTestSeller(owner)
    await addTestLedgerEntries(owner, settled.seller.id, [
      { entryType: 'sale', amountPaise: 10_000 },
      { entryType: 'payout', amountPaise: -10_000 },
    ])
    const owing = await createTestSeller(owner)
    await addTestLedgerEntries(owner, owing.seller.id, [
      { entryType: 'adjustment', amountPaise: -700 },
    ])
    const mine = new Set(
      [owed, owedMore, settled, owing].map(({ seller }) => seller.id),
    )

    const listed = (await allBalances(100)).filter((balance) =>
      mine.has(balance.sellerId),
    )
    expect(listed).toEqual([
      {
        sellerId: owedMore.seller.id,
        displayName: owedMore.seller.displayName,
        status: 'approved',
        balancePaise: 250_000,
        bankAccount: null,
      },
      {
        sellerId: owed.seller.id,
        displayName: owed.seller.displayName,
        status: 'approved',
        balancePaise: 100_000,
        bankAccount: { accountNumberLast4: '6789', ifsc: 'HDFC0001234' },
      },
      {
        sellerId: owing.seller.id,
        displayName: owing.seller.displayName,
        status: 'approved',
        balancePaise: -700,
        bankAccount: null,
      },
    ])
    // Small pages give the same list, with nothing repeated or skipped.
    // Only these sellers' balances are fixed: other test files add entries.
    expect(
      (await allBalances(2)).filter((balance) => mine.has(balance.sellerId)),
    ).toEqual(listed)
  })

  test('only for administrators', async () => {
    const seller = await createTestSeller(owner)
    const context = sellerContext(seller)
    await expect(
      withContext(web, context, (tx) => listSellerBalances(tx, context)),
    ).rejects.toThrow(ForbiddenError)
  })
})

describe('payouts', () => {
  test('records a transfer to the bank account on file, audited', async () => {
    const seller = await withBankAccount(await sellerOwed())
    const recorded = await pay(seller.seller.id, {
      amountPaise: 60_000,
      reference: ' utr-2026-1019-0001 ',
    })
    expect(recorded).toEqual({
      entry: {
        id: expect.any(Number),
        entryType: 'payout',
        amountPaise: -60_000,
        description: 'Payout to account ending 6789 (HDFC0001234)',
        reference: 'UTR-2026-1019-0001',
        orderId: null,
        orderItemId: null,
        returnRequestId: null,
        createdAt: expect.any(Date),
      },
      balancePaise: 40_000,
    })
    const ledger = await asAdmin((tx) =>
      getSellerLedger(tx, admin, seller.seller.id),
    )
    expect(ledger.balancePaise).toBe(40_000)

    const [entry] = await auditFor(seller.seller.id, 'seller.payout.record')
    expect(entry).toMatchObject({
      actorUserId: admin.userId,
      actorRole: 'admin',
      entityType: 'seller',
      ip: '203.0.113.4',
      after: {
        entryId: recorded.entry.id,
        amountPaise: 60_000,
        reference: 'UTR-2026-1019-0001',
        accountNumberLast4: '6789',
        ifsc: 'HDFC0001234',
        balancePaise: 40_000,
      },
    })
    expect(JSON.stringify(entry)).not.toContain('5010012345')
  })

  test('refuses more than the balance, the same transfer twice, or no bank account', async () => {
    const seller = await withBankAccount(await sellerOwed())
    expect(
      await validationIssues(
        pay(seller.seller.id, { amountPaise: 100_001, reference: 'UTR000001' }),
      ),
    ).toEqual(['amountPaise must be at most the seller’s balance of ₹1,000'])

    await pay(seller.seller.id, { amountPaise: 10_000, reference: 'UTR000001' })
    const twice = await rejectionOf(
      pay(seller.seller.id, { amountPaise: 10_000, reference: 'utr000001' }),
      ConflictError,
    )
    expect(twice.message).toBe(
      'A payout with reference UTR000001 is already recorded for this seller',
    )

    const noAccount = await sellerOwed()
    const refused = await rejectionOf(
      pay(noAccount.seller.id, { amountPaise: 100, reference: 'UTR000002' }),
      ConflictError,
    )
    expect(refused.message).toBe(
      'Enter the seller’s bank account before recording a payout',
    )

    expect(
      await validationIssues(
        pay(seller.seller.id, { amountPaise: 0, reference: 'UTR 1' }),
      ),
    ).toEqual([
      'amountPaise must be at least 1',
      'reference must be the transfer reference from the bank: 6 to 40 letters, digits, hyphens, or slashes',
    ])
    await expect(
      pay(crypto.randomUUID(), { amountPaise: 100, reference: 'UTR000003' }),
    ).rejects.toThrow(NotFoundError)
  })

  test('only administrators record payouts', async () => {
    const seller = await withBankAccount(await sellerOwed())
    await expect(
      pay(
        seller.seller.id,
        { amountPaise: 100, reference: 'UTR000004' },
        sellerContext(seller),
      ),
    ).rejects.toThrow(ForbiddenError)
  })

  test('two payouts at once cannot spend the same balance', async () => {
    const seller = await withBankAccount(await sellerOwed())
    const held = await holdRows(
      owner,
      sellerBankAccounts,
      sellerBankAccounts.sellerId,
      [seller.seller.id],
    )
    const racing = Promise.allSettled(
      ['UTR100001', 'UTR100002'].map((reference) =>
        pay(seller.seller.id, { amountPaise: 60_000, reference }),
      ),
    )
    try {
      await waitUntil(
        async () => (await sessionsWaitingOn(owner, held.pid)) >= 2,
      )
    } finally {
      held.release()
      await held.finished
    }
    const results = await racing

    const paid = results.filter((result) => result.status === 'fulfilled')
    const refused = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    )
    expect(paid).toHaveLength(1)
    expect(refused).toHaveLength(1)
    expect(refused[0]).toBeInstanceOf(ValidationError)
    const ledger = await asAdmin((tx) =>
      getSellerLedger(tx, admin, seller.seller.id),
    )
    expect(ledger.balancePaise).toBe(40_000)
  })
})

describe('adjustments', () => {
  test('corrects a balance either way with a reason the seller sees, audited', async () => {
    const seller = await sellerOwed()
    const more = await adjust(seller.seller.id, {
      amountPaise: 2_500,
      reason: '  Delivery charge refunded to the seller for order EK-1  ',
    })
    expect(more.entry).toMatchObject({
      entryType: 'adjustment',
      amountPaise: 2_500,
      description: 'Delivery charge refunded to the seller for order EK-1',
    })
    expect(more.balancePaise).toBe(102_500)
    const less = await adjust(seller.seller.id, {
      amountPaise: -1_000,
      reason: 'Payout of 19 October recorded ₹10 short',
    })
    expect(less.balancePaise).toBe(101_500)

    const audited = await auditFor(seller.seller.id, 'seller.ledger.adjust')
    expect(audited.map((entry) => entry.after)).toEqual([
      {
        entryId: more.entry.id,
        amountPaise: 2_500,
        reason: 'Delivery charge refunded to the seller for order EK-1',
        balancePaise: 102_500,
      },
      {
        entryId: less.entry.id,
        amountPaise: -1_000,
        reason: 'Payout of 19 October recorded ₹10 short',
        balancePaise: 101_500,
      },
    ])
    const context = sellerContext(seller)
    const own = await withContext(web, context, (tx) =>
      getOwnLedger(tx, context),
    )
    expect(own.items[0]!.description).toBe(
      'Payout of 19 October recorded ₹10 short',
    )
  })

  test('needs a whole amount that is not 0, and a reason', async () => {
    const seller = await sellerOwed()
    expect(
      await validationIssues(
        adjust(seller.seller.id, { amountPaise: 0, reason: ' ' }),
      ),
    ).toEqual(['amountPaise must not be 0', 'reason must not be empty'])
    expect(
      await validationIssues(
        adjust(seller.seller.id, { amountPaise: 1.5, reason: 'Rounding' }),
      ),
    ).toEqual(['amountPaise must be a whole number'])
    await expect(
      adjust(
        seller.seller.id,
        { amountPaise: 100, reason: 'Bonus' },
        sellerContext(seller),
      ),
    ).rejects.toThrow(ForbiddenError)
  })
})
