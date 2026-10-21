import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import { auditLogs, settlementStatements } from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  NotSignedInError,
  TooManyRequestsError,
} from '../../errors.ts'
import { startJobQueue, type JobQueue } from '../../lib/queue.ts'
import {
  createObjectStorage,
  loadStorageConfig,
  type ObjectStorage,
} from '../../lib/storage.ts'
import { rejectionOf, validationIssues } from '../../testing/errors.ts'
import {
  addTestLedgerEntries,
  createTestCategory,
  createTestOrder,
  createTestProduct,
  createTestSeller,
  createTestUser,
} from '../../testing/fixtures.ts'
import { makeSettlementStatement } from './jobs.ts'
import {
  getSettlementStatement,
  getSettlementStatementDownload,
  listOwnStatements,
  listSellerStatements,
  MAKE_STATEMENT_QUEUE,
  requestOwnStatement,
  requestSellerStatement,
} from './statements.ts'

/*
 * Settlement statements (design doc 5.9) against the real database, job
 * queue, and object storage: asked for, made by the worker, and downloaded.
 */

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'statements-test')
  pools.push(pool)
  return createDatabase(pool)
}
const web = connect(requireEnv('DATABASE_URL'))
const worker = connect(requireEnv('WORKER_DATABASE_URL'))
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))
const storage = createObjectStorage(loadStorageConfig())
const deps = { db: worker, storage }
let queue: JobQueue
let admin: Extract<RequestContext, { role: 'admin' }>

beforeAll(async () => {
  queue = await startJobQueue(requireEnv('DATABASE_URL'), 'statements-test')
  admin = { role: 'admin', userId: (await createTestUser(owner, 'admin')).id }
})

afterAll(async () => {
  await queue.stop()
  await Promise.all(pools.map((pool) => pool.end()))
})

type TestSeller = Awaited<ReturnType<typeof createTestSeller>>

const sellerContext = ({ owner: user, seller }: TestSeller) =>
  ({
    role: 'seller',
    userId: user.id,
    sellerId: seller.id,
  }) satisfies RequestContext

// A fixed today, so no case depends on the real date.
const TODAY = new Date('2026-10-20T12:00:00+05:30')

const askOwn = (seller: TestSeller, input: unknown) => {
  const context = sellerContext(seller)
  return withContext(web, context, (tx) =>
    requestOwnStatement(tx, queue, context, input, TODAY),
  )
}

const read = (context: RequestContext, id: string) =>
  withContext(web, context, (tx) => getSettlementStatement(tx, context, id))

const download = (context: RequestContext, id: string) =>
  getSettlementStatementDownload({ db: web, storage }, context, id)

const india = (time: string) => new Date(`${time}+05:30`)

describe('making a statement', () => {
  test('the seller asks, the worker makes the CSV, and the seller downloads it', async () => {
    const seller = await createTestSeller(owner)
    const category = await createTestCategory(owner)
    const { product, variant } = await createTestProduct(owner, {
      sellerId: seller.seller.id,
      categoryId: category.id,
    })
    const { order } = await createTestOrder(owner, {
      buyerId: (await createTestUser(owner)).id,
      lines: [
        {
          sellerId: seller.seller.id,
          productId: product.id,
          variantId: variant.id,
        },
      ],
    })
    await addTestLedgerEntries(owner, seller.seller.id, [
      // Before the period: the opening balance.
      {
        entryType: 'sale',
        amountPaise: 100_000,
        createdAt: india('2026-09-30T23:59:59.999'),
      },
      {
        entryType: 'sale',
        amountPaise: 50_000,
        description: 'Sale of 1 × Bamboo bottle',
        orderId: order.id,
        createdAt: india('2026-10-01T00:00:00'),
      },
      {
        entryType: 'commission',
        amountPaise: -5_000,
        description: 'Commission at 10%',
        orderId: order.id,
        createdAt: india('2026-10-01T00:00:00'),
      },
      {
        entryType: 'payout',
        amountPaise: -120_000,
        description: 'Payout to account ending 6789 (HDFC0001234)',
        reference: 'UTR-0001',
        createdAt: india('2026-10-03T12:30:05'),
      },
      {
        entryType: 'adjustment',
        amountPaise: -250,
        description: '=HYPERLINK("http://evil.test")',
        createdAt: india('2026-10-05T23:59:59.999'),
      },
      // After the period: left out.
      {
        entryType: 'sale',
        amountPaise: 7_000,
        createdAt: india('2026-10-06T00:00:00'),
      },
    ])

    const asked = await askOwn(seller, { from: '2026-10-01', to: '2026-10-05' })
    expect(asked).toEqual({
      id: expect.any(String),
      sellerId: seller.seller.id,
      from: '2026-10-01',
      to: '2026-10-05',
      status: 'processing',
      openingBalancePaise: null,
      closingBalancePaise: null,
      entryCount: null,
      failureReason: null,
      requestedAt: expect.any(Date),
      madeAt: null,
    })
    const jobs = await owner.execute<{ count: number }>(
      sql`select count(*)::int as count from pgboss.job where name = ${MAKE_STATEMENT_QUEUE} and data->>'statementId' = ${asked.id}`,
    )
    expect(jobs.rows[0]!.count).toBe(1)
    const context = sellerContext(seller)
    const waiting = await rejectionOf(
      download(context, asked.id),
      ConflictError,
    )
    expect(waiting.message).toBe(
      'The statement is still being made; try again in a moment',
    )

    await makeSettlementStatement(deps, asked.id)
    const made = await read(context, asked.id)
    expect(made).toMatchObject({
      status: 'ready',
      openingBalancePaise: 100_000,
      closingBalancePaise: 24_750,
      entryCount: 4,
      madeAt: expect.any(Date),
    })

    const link = await download(context, asked.id)
    expect(link.fileName).toBe('settlement-2026-10-01-to-2026-10-05.csv')
    const response = await fetch(link.url)
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="settlement-2026-10-01-to-2026-10-05.csv"; filename*=UTF-8''settlement-2026-10-01-to-2026-10-05.csv`,
    )
    // Read as bytes: text() would drop the byte order mark Excel needs.
    expect(Buffer.from(await response.arrayBuffer()).toString('utf8')).toBe(
      [
        '﻿"Date and time (IST)","Type","Description","Order","Reference","Amount (₹)","Balance (₹)"',
        '"2026-10-01 00:00:00","Opening balance","","","","","1000.00"',
        `"2026-10-01 00:00:00","Sale","Sale of 1 × Bamboo bottle","${order.orderNumber}","","500.00","1500.00"`,
        `"2026-10-01 00:00:00","Commission","Commission at 10%","${order.orderNumber}","","-50.00","1450.00"`,
        '"2026-10-03 12:30:05","Payout","Payout to account ending 6789 (HDFC0001234)","","UTR-0001","-1200.00","250.00"',
        '"2026-10-05 23:59:59","Adjustment","\'=HYPERLINK(""http://evil.test"")","","","-2.50","247.50"',
        '"2026-10-05 23:59:59","Closing balance","","","","","247.50"',
        '',
      ].join('\r\n'),
    )
    expect(
      (
        await fetch(
          storage.publicUrl(`settlements/${seller.seller.id}/${asked.id}.csv`),
        )
      ).status,
    ).toBe(403)

    // A second run changes nothing.
    await makeSettlementStatement(deps, asked.id)
    expect((await read(context, asked.id)).madeAt).toEqual(made.madeAt)
  })

  test('a period that has not ended closes when the statement was made', async () => {
    const seller = await createTestSeller(owner)
    await addTestLedgerEntries(owner, seller.seller.id, [
      { entryType: 'sale', amountPaise: 12_345 },
    ])
    // Written directly: asking for one refuses a period that ends later.
    const [statement] = await owner
      .insert(settlementStatements)
      .values({
        sellerId: seller.seller.id,
        periodStart: '2098-12-31',
        periodEnd: '2099-01-01',
      })
      .returning()
    const before = Date.now()
    await makeSettlementStatement(deps, statement!.id)
    const after = Date.now()
    const link = await download(admin, statement!.id)
    const lines = Buffer.from(await (await fetch(link.url)).arrayBuffer())
      .toString('utf8')
      .split('\r\n')
    const closing = /^"([\d-]+ [\d:]+)","Closing balance",.*,"123\.45"$/.exec(
      lines.at(-2)!,
    )
    const closedAt = new Date(`${closing![1]!.replace(' ', 'T')}+05:30`)
    // The file shows whole seconds.
    expect(closedAt.getTime()).toBeGreaterThan(before - 1000)
    expect(closedAt.getTime()).toBeLessThanOrEqual(after)
  })

  test('a period with no entries still has both balances', async () => {
    const seller = await createTestSeller(owner)
    const statement = await askOwn(seller, {
      from: '2026-10-20',
      to: '2026-10-20',
    })
    await makeSettlementStatement(deps, statement.id)
    expect(await read(admin, statement.id)).toMatchObject({
      status: 'ready',
      openingBalancePaise: 0,
      closingBalancePaise: 0,
      entryCount: 0,
    })
  })

  test('retries when storage fails, and gives up plainly on the last try', async () => {
    const seller = await createTestSeller(owner)
    const statement = await askOwn(seller, {
      from: '2026-10-01',
      to: '2026-10-19',
    })
    const failing: ObjectStorage = {
      ...storage,
      write: () => Promise.reject(new Error('Storage is unavailable')),
    }
    await expect(
      makeSettlementStatement({ db: worker, storage: failing }, statement.id, {
        lastAttempt: false,
      }),
    ).rejects.toThrow('Storage is unavailable')
    expect((await read(admin, statement.id)).status).toBe('processing')

    await makeSettlementStatement(
      { db: worker, storage: failing },
      statement.id,
    )
    expect(await read(admin, statement.id)).toMatchObject({
      status: 'failed',
      failureReason: 'The statement could not be made; ask for it again',
    })
    const refused = await rejectionOf(
      download(sellerContext(seller), statement.id),
      ConflictError,
    )
    expect(refused.message).toBe(
      'This statement could not be made; ask for a new one',
    )
  })
})

describe('asking for a statement', () => {
  test('checks the period against today in India', async () => {
    const seller = await createTestSeller(owner)
    expect(
      await validationIssues(
        askOwn(seller, { from: '2026-10-10', to: '2026-10-21' }),
      ),
    ).toEqual(['to must not be after today'])
    expect(
      await validationIssues(
        askOwn(seller, { from: '2026-10-10', to: '2026-10-09' }),
      ),
    ).toEqual(['from must not be after to'])
    expect(
      await validationIssues(
        askOwn(seller, { from: '2025-10-18', to: '2026-10-19' }),
      ),
    ).toEqual(['a statement can cover at most 366 days'])
    await askOwn(seller, { from: '2025-10-20', to: '2026-10-20' })
    expect(
      await validationIssues(
        askOwn(seller, { from: '2026-02-30', to: '1 October', extra: 1 }),
      ),
    ).toEqual([
      'from must be a real date',
      'to must be a date like 2026-10-01',
      'extra is not allowed here',
    ])
  })

  test('allows 20 statements a day for each seller', async () => {
    const seller = await createTestSeller(owner)
    await owner.insert(settlementStatements).values(
      Array.from({ length: 20 }, () => ({
        sellerId: seller.seller.id,
        periodStart: '2026-10-01',
        periodEnd: '2026-10-01',
      })),
    )
    const error = await rejectionOf(
      askOwn(seller, { from: '2026-10-01', to: '2026-10-19' }),
      TooManyRequestsError,
    )
    expect(error.message).toBe(
      'At most 20 statements can be asked for in a day; open one already made, or try again tomorrow',
    )
    // Another seller is not held back.
    await askOwn(await createTestSeller(owner), {
      from: '2026-10-01',
      to: '2026-10-19',
    })
  })

  test('administrators ask for any seller’s statement, audited', async () => {
    const seller = await createTestSeller(owner)
    const statement = await withContext(web, admin, (tx) =>
      requestSellerStatement(
        tx,
        queue,
        admin,
        seller.seller.id,
        { from: '2026-09-01', to: '2026-09-30' },
        '203.0.113.4',
        TODAY,
      ),
    )
    expect(statement.sellerId).toBe(seller.seller.id)
    const [audit] = await owner
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, 'seller.statement.request'),
          eq(auditLogs.entityId, seller.seller.id),
        ),
      )
    expect(audit).toMatchObject({
      actorUserId: admin.userId,
      ip: '203.0.113.4',
      after: {
        statementId: statement.id,
        from: '2026-09-01',
        to: '2026-09-30',
      },
    })
    const context = sellerContext(seller)
    await expect(
      withContext(web, context, (tx) =>
        requestSellerStatement(
          tx,
          queue,
          context,
          seller.seller.id,
          { from: '2026-09-01', to: '2026-09-30' },
          null,
          TODAY,
        ),
      ),
    ).rejects.toThrow(ForbiddenError)
  })
})

describe('reading statements', () => {
  test('lists a seller’s statements newest first, for the seller and administrators', async () => {
    const seller = await createTestSeller(owner)
    const first = await askOwn(seller, { from: '2026-09-01', to: '2026-09-30' })
    const second = await askOwn(seller, {
      from: '2026-10-01',
      to: '2026-10-19',
    })
    const third = await askOwn(seller, { from: '2026-10-19', to: '2026-10-19' })
    const context = sellerContext(seller)
    const page = await withContext(web, context, (tx) =>
      listOwnStatements(tx, context, { limit: 2 }),
    )
    expect(page.items.map((item) => item.id)).toEqual([third.id, second.id])
    const next = await withContext(web, admin, (tx) =>
      listSellerStatements(tx, admin, seller.seller.id, {
        limit: 2,
        cursor: page.nextCursor!,
      }),
    )
    expect(next.items.map((item) => item.id)).toEqual([first.id])
    expect(next.nextCursor).toBeNull()
  })

  test('only the seller and administrators see a statement', async () => {
    const seller = await createTestSeller(owner)
    const statement = await askOwn(seller, {
      from: '2026-10-01',
      to: '2026-10-19',
    })
    await makeSettlementStatement(deps, statement.id)
    expect((await read(admin, statement.id)).status).toBe('ready')
    expect((await download(admin, statement.id)).fileName).toBe(
      'settlement-2026-10-01-to-2026-10-19.csv',
    )

    const other = sellerContext(await createTestSeller(owner))
    const buyer: RequestContext = {
      role: 'buyer',
      userId: (await createTestUser(owner)).id,
    }
    for (const context of [other, buyer]) {
      await expect(read(context, statement.id)).rejects.toThrow(NotFoundError)
      await expect(download(context, statement.id)).rejects.toThrow(
        NotFoundError,
      )
    }
    await expect(read({ role: 'anonymous' }, statement.id)).rejects.toThrow(
      NotSignedInError,
    )
    await expect(read(admin, 'not-an-id')).rejects.toThrow(NotFoundError)
    await expect(
      withContext(web, buyer, (tx) => listOwnStatements(tx, buyer)),
    ).rejects.toThrow(ForbiddenError)
  })
})
