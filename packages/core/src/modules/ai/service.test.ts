import { randomUUID } from 'node:crypto'
import { count, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import {
  createDatabase,
  type Database,
  type Transaction,
} from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import { aiRequests } from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import {
  ForbiddenError,
  NotConfiguredError,
  TooManyRequestsError,
} from '../../errors.ts'
import { AiReplyError, type ModelReply } from '../../lib/ai/client.ts'
import { createAiModels, type AiModels } from '../../lib/ai/index.ts'
import {
  fakeChatReply,
  startFakeAiServer,
  type FakeAiServer,
} from '../../testing/ai.ts'
import { rejectionOf } from '../../testing/errors.ts'
import { createTestSeller, createTestUser } from '../../testing/fixtures.ts'
import { sessionsWaitingOn, waitUntil } from '../../testing/locks.ts'
import { settingDefinitions } from '../settings/definitions.ts'
import {
  aiInputHash,
  callAi,
  DAILY_LIMITS_LOCK,
  LIMIT_RULES,
  type AiCall,
} from './service.ts'
import { DAY_MS, indianDayStart } from './days.ts'

const pools: DatabasePool[] = []
function connect(url: string, name: string): Database {
  const pool = createPool(url, name)
  pools.push(pool)
  return createDatabase(pool)
}

// Fixtures and checks as the owner; every call as the web app or worker.
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'), 'ai-test-owner')
const web = connect(requireEnv('DATABASE_URL'), 'ai-test-web')
const worker = connect(requireEnv('WORKER_DATABASE_URL'), 'ai-test-worker')

const system: RequestContext = { role: 'system' }
const anonymous: RequestContext = { role: 'anonymous' }

// The settings test file owns platform_settings and empties it before each
// test, so these tests use the default limits and write that many calls.
const SELLER_LIMIT = settingDefinitions.ai_daily_limit_seller.default!
const PLATFORM_LIMIT = settingDefinitions.ai_daily_limit_platform.default!

let fake: FakeAiServer
let models: AiModels

beforeAll(async () => {
  fake = await startFakeAiServer()
  models = createAiModels(fake.settings())
})

afterAll(async () => {
  await fake.close()
  await Promise.all(pools.map((pool) => pool.end()))
})

const query = z.strictObject({
  category: z.string(),
  maxPricePaise: z.number(),
})
type Query = z.output<typeof query>

const reply = <T>(value: T): ModelReply<T> => ({
  value,
  usage: { inputTokens: 90, outputTokens: 12, costUsd: 0.000_02 },
})

/** A shared natural-language query call, unique unless `input` is given. */
function nlCall(
  overrides: Partial<AiCall<'text', Query>> = {},
): AiCall<'text', Query> {
  return {
    feature: 'nl_search',
    uses: 'text',
    input: { query: `steel bottle ${randomUUID()}` },
    schema: query,
    run: async () =>
      reply({ category: 'steel-bottles', maxPricePaise: 50_000 }),
    ...overrides,
  }
}

async function sellerContext(): Promise<{
  context: RequestContext & { role: 'seller' }
  sellerId: string
}> {
  const { owner: account, seller } = await createTestSeller(owner)
  return {
    context: { role: 'seller', userId: account.id, sellerId: seller.id },
    sellerId: seller.id,
  }
}

/** A seller's listing draft call, which counts against the seller's limit. */
function draftCall(
  sellerId: string,
  overrides: Partial<AiCall<'vision', Query>> = {},
): AiCall<'vision', Query> {
  return {
    feature: 'listing_draft',
    uses: 'vision',
    sellerId,
    input: { photos: [`https://images.ecokart.example/${randomUUID()}`] },
    schema: query,
    run: async () => reply({ category: 'bamboo', maxPricePaise: 19_900 }),
    ...overrides,
  }
}

async function rowOf(id: string) {
  const [row] = await owner
    .select()
    .from(aiRequests)
    .where(eq(aiRequests.id, id))
  return row!
}

/** Calls already made today, written straight into the table. */
async function insertCalls(
  howMany: number,
  values: Partial<typeof aiRequests.$inferInsert> = {},
): Promise<void> {
  await owner.insert(aiRequests).values(
    Array.from({ length: howMany }, () => ({
      feature: 'listing_draft',
      provider: 'local',
      model: 'test-model',
      inputHash: randomUUID(),
      status: 'succeeded',
      ...values,
    })),
  )
}

async function rowsForSeller(sellerId: string): Promise<number> {
  const [row] = await owner
    .select({ n: count() })
    .from(aiRequests)
    .where(eq(aiRequests.sellerId, sellerId))
  return row!.n
}

const ask = (call: AiCall<'text', Query>, now?: Date) =>
  callAi(web, anonymous, models, call, now)

const asWeb = <T>(
  context: RequestContext,
  work: (tx: Transaction) => Promise<T>,
) => withContext(web, context, work)

describe('callAi', () => {
  test('stops when AI is switched off, before writing anything', async () => {
    const call = nlCall()
    await expect(callAi(web, anonymous, null, call)).rejects.toThrow(
      new NotConfiguredError('AI features are switched off'),
    )
    const hash = aiInputHash(
      'nl_search',
      'deepseek/deepseek-v4.1-flash',
      call.input,
    )
    expect(
      await owner
        .select()
        .from(aiRequests)
        .where(eq(aiRequests.inputHash, hash)),
    ).toEqual([])
  })

  test('asks the model and records the call with its usage', async () => {
    fake.queue(
      fakeChatReply(
        { category: 'steel-bottles', maxPricePaise: 50_000 },
        { inputTokens: 300, outputTokens: 20, costUsd: 0.000_05 },
      ),
    )
    const input = { query: `steel bottle under 500 ${randomUUID()}` }
    const answer = await callAi(web, anonymous, models, {
      ...nlCall({ input }),
      run: (text) =>
        text.json(
          {
            system: 'Turn a shopper’s search into filters.',
            user: input.query,
            example: { category: 'steel-bottles', maxPricePaise: 50_000 },
          },
          query,
        ),
    })

    expect(answer).toMatchObject({
      value: { category: 'steel-bottles', maxPricePaise: 50_000 },
      cached: false,
    })
    const row = await rowOf(answer.requestId)
    expect(row).toMatchObject({
      feature: 'nl_search',
      userId: null,
      sellerId: null,
      provider: 'local',
      model: 'deepseek/deepseek-v4.1-flash',
      inputHash: aiInputHash(
        'nl_search',
        'deepseek/deepseek-v4.1-flash',
        input,
      ),
      status: 'succeeded',
      result: { category: 'steel-bottles', maxPricePaise: 50_000 },
      error: null,
      inputTokens: 300,
      outputTokens: 20,
      costMicroUsd: 50,
    })
    expect(row.latencyMs).toBeGreaterThanOrEqual(0)
    expect(row.completedAt).toBeInstanceOf(Date)
  })

  test('records a failed call with what it used, and passes the error on', async () => {
    fake.queue(
      fakeChatReply('not json', {
        inputTokens: 100,
        outputTokens: 4,
        costUsd: 0.000_01,
      }),
      fakeChatReply('still not json', {
        inputTokens: 110,
        outputTokens: 5,
        costUsd: 0.000_012,
      }),
    )
    const { context, sellerId } = await sellerContext()
    await rejectionOf(
      callAi(web, context, models, {
        feature: 'import_mapping',
        uses: 'text',
        sellerId,
        input: { headers: ['Name', 'Price'], file: randomUUID() },
        schema: query,
        run: (text) =>
          text.json(
            { system: 'Map columns.', user: 'Name, Price', example: {} },
            query,
          ),
      }),
      AiReplyError,
    )

    const [row] = await owner
      .select()
      .from(aiRequests)
      .where(eq(aiRequests.sellerId, sellerId))
    expect(row).toMatchObject({
      status: 'failed',
      result: null,
      inputTokens: 210,
      outputTokens: 9,
      costMicroUsd: 22,
    })
    expect(row!.error).toMatch(/^The AI model's answer could not be used twice/)
  })

  test('records a call that failed before the model answered', async () => {
    const error = new Error('The AI provider could not be reached: refused')
    const { context, sellerId } = await sellerContext()
    await expect(
      callAi(web, context, models, {
        ...draftCall(sellerId),
        run: async () => {
          throw error
        },
      }),
    ).rejects.toBe(error)
    const [row] = await owner
      .select()
      .from(aiRequests)
      .where(eq(aiRequests.sellerId, sellerId))
    expect(row).toMatchObject({
      status: 'failed',
      error: error.message,
      inputTokens: 0,
      outputTokens: 0,
      costMicroUsd: null,
    })
  })

  test('works from the worker as well as the web app', async () => {
    const answer = await callAi(worker, system, models, nlCall())
    expect((await rowOf(answer.requestId)).status).toBe('succeeded')
  })
})

describe('the cache', () => {
  test('answers the same input again without calling the model or writing a row', async () => {
    const input = { query: `jute bag ${randomUUID()}` }
    const first = await ask(nlCall({ input, cacheSeconds: 86_400 }))
    let called = false
    const second = await ask(
      nlCall({
        input: { ...input },
        cacheSeconds: 86_400,
        run: async () => {
          called = true
          return reply({ category: 'other', maxPricePaise: 1 })
        },
      }),
    )
    expect(second).toEqual({
      requestId: first.requestId,
      value: first.value,
      cached: true,
    })
    expect(called).toBe(false)
  })

  test('finds the same input whatever the order of its keys', () => {
    expect(aiInputHash('nl_search', 'm', { a: 1, b: { c: 2, d: 3 } })).toBe(
      aiInputHash('nl_search', 'm', { b: { d: 3, c: 2 }, a: 1 }),
    )
    expect(aiInputHash('nl_search', 'm', { a: 1 })).not.toBe(
      aiInputHash('nl_search', 'other-model', { a: 1 }),
    )
    expect(aiInputHash('nl_search', 'm', { a: 1 })).not.toBe(
      aiInputHash('assistant', 'm', { a: 1 }),
    )
    expect(aiInputHash('nl_search', 'm', [1, 2])).not.toBe(
      aiInputHash('nl_search', 'm', [2, 1]),
    )
  })

  test('asks again for another input, another model, or no cache lifetime', async () => {
    const input = { query: `clay pot ${randomUUID()}` }
    const first = await ask(nlCall({ input, cacheSeconds: 86_400 }))

    const otherInput = await ask(
      nlCall({ input: { query: `${input.query}!` }, cacheSeconds: 86_400 }),
    )
    expect(otherInput.cached).toBe(false)

    const otherModel = createAiModels(
      fake.settings({ chatModel: 'deepseek/other' }),
    )
    const fromOtherModel = await callAi(web, anonymous, otherModel, {
      ...nlCall({ input, cacheSeconds: 86_400 }),
    })
    expect(fromOtherModel.cached).toBe(false)

    const noLifetime = await ask(nlCall({ input }))
    expect(noLifetime.cached).toBe(false)
    expect(noLifetime.requestId).not.toBe(first.requestId)
  })

  test('asks again once the stored answer is older than the lifetime', async () => {
    const input = { query: `soap ${randomUUID()}` }
    const first = await ask(nlCall({ input, cacheSeconds: 3600 }))
    const later = new Date(Date.now() + 2 * 3600 * 1000)
    const again = await ask(nlCall({ input, cacheSeconds: 3600 }), later)
    expect(again.cached).toBe(false)
    expect(again.requestId).not.toBe(first.requestId)
  })

  test('never shares a seller’s answer with anyone else, or a shared one with a seller', async () => {
    const a = await sellerContext()
    const b = await sellerContext()
    const input = { photos: [`https://images.ecokart.example/${randomUUID()}`] }
    const first = await callAi(web, a.context, models, {
      ...draftCall(a.sellerId, { input, cacheSeconds: 86_400 }),
    })
    const again = await callAi(web, a.context, models, {
      ...draftCall(a.sellerId, { input, cacheSeconds: 86_400 }),
    })
    expect(again).toMatchObject({ requestId: first.requestId, cached: true })

    const otherSeller = await callAi(web, b.context, models, {
      ...draftCall(b.sellerId, { input, cacheSeconds: 86_400 }),
    })
    expect(otherSeller.cached).toBe(false)

    // Screening may be made with or without a seller.
    const screening = (sellerId?: string) =>
      callAi(web, system, models, {
        ...draftCall(a.sellerId, { input, cacheSeconds: 86_400 }),
        feature: 'screening',
        sellerId,
      })
    await screening(a.sellerId)
    expect((await screening()).cached).toBe(false)
  })

  test('does not reuse an answer that no longer fits the schema', async () => {
    const input = { query: `basket ${randomUUID()}` }
    await ask(nlCall({ input, cacheSeconds: 86_400 }))
    const stricter = query.extend({ brand: z.string() })
    const again = await callAi(web, anonymous, models, {
      feature: 'nl_search',
      uses: 'text',
      input,
      cacheSeconds: 86_400,
      schema: stricter,
      run: async () =>
        reply({ category: 'baskets', maxPricePaise: 1, brand: 'Bamboo Home' }),
    })
    expect(again.cached).toBe(false)
  })

  test('never serves a failed call', async () => {
    const input = { query: `mat ${randomUUID()}` }
    await expect(
      ask(
        nlCall({
          input,
          cacheSeconds: 86_400,
          run: async () => {
            throw new Error('down')
          },
        }),
      ),
    ).rejects.toThrow('down')
    expect((await ask(nlCall({ input, cacheSeconds: 86_400 }))).cached).toBe(
      false,
    )
  })
})

describe('daily limits', () => {
  test('a day starts at midnight India time', () => {
    expect(indianDayStart(new Date('2026-10-11T18:29:59.999Z'))).toEqual(
      new Date('2026-10-10T18:30:00Z'),
    )
    expect(indianDayStart(new Date('2026-10-11T18:30:00Z'))).toEqual(
      new Date('2026-10-11T18:30:00Z'),
    )
    expect(indianDayStart(new Date('2026-10-11T03:00:00Z'))).toEqual(
      new Date('2026-10-10T18:30:00Z'),
    )
  })

  test('refuses a seller’s call once their limit is used up, until midnight India time', async () => {
    const { context, sellerId } = await sellerContext()
    await insertCalls(SELLER_LIMIT, { sellerId })
    const now = new Date()
    const error = await rejectionOf(
      callAi(web, context, models, draftCall(sellerId), now),
      TooManyRequestsError,
    )
    expect(error.message).toBe(
      `You have used today’s ${SELLER_LIMIT} AI calls; more are available after midnight India time`,
    )
    expect(error.resetAt).toEqual(
      new Date(indianDayStart(now).getTime() + 24 * 3600 * 1000),
    )
    expect(await rowsForSeller(sellerId)).toBe(SELLER_LIMIT)
  })

  test('counts failed calls, but not yesterday’s', async () => {
    const { context, sellerId } = await sellerContext()
    const yesterday = new Date(indianDayStart(new Date()).getTime() - 1)
    await insertCalls(5, { sellerId, createdAt: yesterday })
    await insertCalls(SELLER_LIMIT - 1, { sellerId, status: 'failed' })

    await callAi(web, context, models, draftCall(sellerId))
    await expect(
      callAi(web, context, models, draftCall(sellerId)),
    ).rejects.toThrow(TooManyRequestsError)
  })

  test('still answers from the cache when the limit is used up', async () => {
    const { context, sellerId } = await sellerContext()
    const input = { photos: [`https://images.ecokart.example/${randomUUID()}`] }
    const first = await callAi(
      web,
      context,
      models,
      draftCall(sellerId, { input, cacheSeconds: 86_400 }),
    )
    await insertCalls(SELLER_LIMIT, { sellerId })
    const again = await callAi(
      web,
      context,
      models,
      draftCall(sellerId, { input, cacheSeconds: 86_400 }),
    )
    expect(again).toMatchObject({ requestId: first.requestId, cached: true })
  })

  test('does not count or refuse embeddings', async () => {
    const { context, sellerId } = await sellerContext()
    await insertCalls(SELLER_LIMIT, { sellerId, feature: 'embedding' })
    await callAi(web, context, models, draftCall(sellerId))
    await insertCalls(SELLER_LIMIT, { sellerId })
    const embedding = await callAi(web, context, models, {
      feature: 'embedding',
      uses: 'embed',
      sellerId,
      input: { text: 'Bamboo Toothbrush' },
      schema: z.array(z.array(z.number())),
      run: async () => reply([[0.1, 0.2]]),
    })
    expect(embedding.cached).toBe(false)
  })

  test('screening counts against the platform, never against the seller', async () => {
    const { context, sellerId } = await sellerContext()
    await insertCalls(SELLER_LIMIT, { sellerId, feature: 'screening' })
    await callAi(web, context, models, draftCall(sellerId))
    await insertCalls(SELLER_LIMIT, { sellerId })
    const screening = await callAi(web, system, models, {
      ...draftCall(sellerId),
      feature: 'screening',
    })
    expect((await rowOf(screening.requestId)).sellerId).toBe(sellerId)
  })

  test('a call that counts against a seller must name the seller', async () => {
    await expect(
      callAi(web, system, models, {
        ...draftCall(randomUUID()),
        sellerId: undefined,
      }),
    ).rejects.toThrow('listing_draft calls must name the seller they are for')
  })

  test('every feature the database allows has a limit rule', async () => {
    const { rows } = await owner.execute<{ definition: string }>(
      sql`select pg_get_constraintdef(oid) as definition from pg_constraint where conname = 'ai_requests_feature_check'`,
    )
    const allowed = [...rows[0]!.definition.matchAll(/'([a-z_]+)'/g)].map(
      (match) => match[1],
    )
    expect(new Set(Object.keys(LIMIT_RULES))).toEqual(new Set(allowed))
  })

  test('refuses every counted call once the platform limit is used up', async () => {
    // A day three days ago, filled up to the limit. Its count also includes
    // every later call, so other test files only raise it, and today's count,
    // which their own calls depend on, is untouched.
    const day = new Date(indianDayStart(new Date()).getTime() - 3 * DAY_MS)
    const filler = 'platform-limit-test'
    await insertCalls(PLATFORM_LIMIT, {
      model: filler,
      createdAt: new Date(day.getTime() + 60_000),
    })
    const thatDay = new Date(day.getTime() + 3_600_000)
    try {
      const error = await rejectionOf(
        callAi(web, anonymous, models, nlCall(), thatDay),
        TooManyRequestsError,
      )
      expect(error.message).toBe(
        'Today’s AI calls for EcoKart are used up; more are available after midnight India time',
      )
      expect(error.resetAt).toEqual(new Date(day.getTime() + DAY_MS))
      const { context, sellerId } = await sellerContext()
      await expect(
        callAi(web, context, models, draftCall(sellerId), thatDay),
      ).rejects.toThrow(error.message)
    } finally {
      await owner.delete(aiRequests).where(eq(aiRequests.model, filler))
    }
  })

  test('two calls racing for the last call of the day: one is answered, one refused', async () => {
    const { context, sellerId } = await sellerContext()
    await insertCalls(SELLER_LIMIT - 1, { sellerId })

    // Hold the limits lock so both calls are waiting for it at once.
    const released = Promise.withResolvers<void>()
    const held = Promise.withResolvers<number>()
    const holder = owner.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${DAILY_LIMITS_LOCK})`)
      const { rows } = await tx.execute<{ pid: number }>(
        sql`select pg_backend_pid() as pid`,
      )
      held.resolve(rows[0]!.pid)
      await released.promise
    })
    const pid = await held.promise

    const racing = [
      callAi(web, context, models, draftCall(sellerId)),
      callAi(web, context, models, draftCall(sellerId)),
    ]
    await waitUntil(async () => (await sessionsWaitingOn(owner, pid)) === 2)
    released.resolve()
    await holder

    const results = await Promise.allSettled(racing)
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    const [refused] = results.filter((result) => result.status === 'rejected')
    expect(refused!.reason).toBeInstanceOf(TooManyRequestsError)
    expect(await rowsForSeller(sellerId)).toBe(SELLER_LIMIT)
  })
})

describe('who may call', () => {
  test('only a seller may make calls for their own business', async () => {
    const a = await sellerContext()
    const b = await sellerContext()
    const buyer = await createTestUser(owner)
    for (const context of [
      b.context,
      anonymous,
      { role: 'buyer', userId: buyer.id } satisfies RequestContext,
    ]) {
      await expect(
        callAi(web, context, models, draftCall(a.sellerId)),
      ).rejects.toThrow(
        new ForbiddenError('AI calls can only be made for your own business'),
      )
    }
  })

  test('a call private to a user is made only for that user', async () => {
    const buyer = await createTestUser(owner)
    const other = await createTestUser(owner)
    const context: RequestContext = { role: 'buyer', userId: buyer.id }
    const own = await callAi(web, context, models, nlCall({ userId: buyer.id }))
    expect((await rowOf(own.requestId)).userId).toBe(buyer.id)
    await expect(
      callAi(web, context, models, nlCall({ userId: other.id })),
    ).rejects.toThrow(ForbiddenError)
  })
})

describe('row-level security on ai_requests', () => {
  test('visitors see shared rows and their own, never another user’s or seller’s', async () => {
    const seller = await sellerContext()
    const buyer = await createTestUser(owner)
    const shared = await callAi(web, anonymous, models, nlCall())
    const sellerRow = await callAi(
      web,
      seller.context,
      models,
      draftCall(seller.sellerId),
    )
    const buyerRow = await callAi(
      web,
      { role: 'buyer', userId: buyer.id },
      models,
      nlCall({ userId: buyer.id }),
    )
    const ids = [shared.requestId, sellerRow.requestId, buyerRow.requestId]
    const visible = async (context: RequestContext) =>
      (
        await asWeb(context, (tx) =>
          tx
            .select({ id: aiRequests.id })
            .from(aiRequests)
            .where(inArray(aiRequests.id, ids)),
        )
      )
        .map((row) => row.id)
        .toSorted()

    expect(await visible(anonymous)).toEqual([shared.requestId])
    expect(await visible(seller.context)).toEqual(
      [shared.requestId, sellerRow.requestId].toSorted(),
    )
    expect(await visible({ role: 'buyer', userId: buyer.id })).toEqual(
      [shared.requestId, buyerRow.requestId].toSorted(),
    )
  })

  test('the web app cannot change a stored answer', async () => {
    const answer = await callAi(web, anonymous, models, nlCall())
    const changed = await asWeb(anonymous, (tx) =>
      tx
        .update(aiRequests)
        .set({ result: { category: 'poisoned', maxPricePaise: 1 } })
        .where(eq(aiRequests.id, answer.requestId))
        .returning({ id: aiRequests.id }),
    )
    expect(changed).toEqual([])
    expect((await rowOf(answer.requestId)).result).toEqual(answer.value)
  })

  test('the web app cannot write a finished answer straight into the cache', async () => {
    const attempt = asWeb(anonymous, (tx) =>
      tx.insert(aiRequests).values({
        feature: 'nl_search',
        provider: 'local',
        model: 'deepseek/deepseek-v4.1-flash',
        inputHash: randomUUID(),
        status: 'succeeded',
        result: { category: 'poisoned', maxPricePaise: 1 },
      }),
    )
    await expect(attempt).rejects.toMatchObject({
      cause: expect.objectContaining({ code: '42501' }),
    })
  })

  test('the worker and administrators can still correct a stored answer', async () => {
    const admin = await createTestUser(owner, 'admin')
    const answer = await callAi(web, anonymous, models, nlCall())
    const byAdmin = await asWeb({ role: 'admin', userId: admin.id }, (tx) =>
      tx
        .update(aiRequests)
        .set({ error: 'checked by hand' })
        .where(eq(aiRequests.id, answer.requestId))
        .returning({ id: aiRequests.id }),
    )
    expect(byAdmin).toHaveLength(1)
    const byWorker = await worker
      .update(aiRequests)
      .set({ error: null })
      .where(eq(aiRequests.id, answer.requestId))
      .returning({ id: aiRequests.id })
    expect(byWorker).toHaveLength(1)
  })

  test('the counting function counts rows the caller cannot see', async () => {
    const seller = await sellerContext()
    const buyer = await createTestUser(owner)
    await insertCalls(2, { sellerId: seller.sellerId })
    const since = indianDayStart(new Date())
    const counts = await asWeb(
      { role: 'buyer', userId: buyer.id },
      async (tx) => {
        const visible = await tx
          .select({ n: count() })
          .from(aiRequests)
          .where(eq(aiRequests.sellerId, seller.sellerId))
        const { rows } = await tx.execute<{ seller_calls: number }>(
          sql`select seller_calls from app.ai_calls_since(${since}, ${seller.sellerId}, ${sql.param(['listing_draft'])}::text[], ${sql.param(['listing_draft'])}::text[])`,
        )
        return { visible: visible[0]!.n, counted: rows[0]!.seller_calls }
      },
    )
    expect(counts).toEqual({ visible: 0, counted: 2 })
  })
})
