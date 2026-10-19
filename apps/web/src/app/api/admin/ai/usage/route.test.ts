import { randomUUID } from 'node:crypto'
import { createDatabase, createPool, requireEnv, schema } from '@ecokart/core'
import { createTestSeller, createTestUser } from '@ecokart/core/testing'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { closePool } from '@/lib/db'
import { closeJobQueue } from '@/lib/queue'
import { signInWithEmail } from '@/testing/sign-in'
import { apiRequest } from '@/testing/requests'
import { GET } from './route'

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'ai-usage-route-test',
)
const owner = createDatabase(ownerPool)

let adminCookie: string
let buyerCookie: string

type Call = typeof schema.aiRequests.$inferInsert

const call = (values: Partial<Call>): Call => ({
  feature: 'listing_draft',
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4.1-flash',
  inputHash: randomUUID(),
  status: 'succeeded',
  inputTokens: 1000,
  outputTokens: 200,
  costMicroUsd: 270,
  ...values,
})

beforeAll(async () => {
  const admin = await createTestUser(owner, 'admin')
  adminCookie = await signInWithEmail(owner, admin.email)
  buyerCookie = await signInWithEmail(
    owner,
    `${crypto.randomUUID()}@example.test`,
  )
  const { seller } = await createTestSeller(owner)
  await owner.insert(schema.aiRequests).values([
    // 20:00 UTC on 1 September is 01:30 on 2 September in India.
    call({ sellerId: seller.id, createdAt: new Date('2026-09-01T20:00:00Z') }),
    call({
      sellerId: seller.id,
      status: 'failed',
      inputTokens: 300,
      outputTokens: 0,
      costMicroUsd: 45,
      createdAt: new Date('2026-09-02T10:00:00Z'),
    }),
    call({
      feature: 'nl_search',
      inputTokens: 80,
      outputTokens: 20,
      // DeepSeek direct reports no cost.
      provider: 'deepseek',
      costMicroUsd: null,
      createdAt: new Date('2026-09-02T12:00:00Z'),
    }),
    // 18:00 UTC on 1 September is 23:30 on 1 September in India.
    call({ feature: 'nl_search', createdAt: new Date('2026-09-01T18:00:00Z') }),
    // Outside the dates asked for.
    call({ createdAt: new Date('2026-08-20T10:00:00Z') }),
    // Today, for the limit.
    call({ feature: 'assistant' }),
  ])
})

afterAll(async () => {
  await closeJobQueue()
  await closePool()
  await ownerPool.end()
})

const usage = (query: string, cookie?: string) =>
  GET(apiRequest(`/admin/ai/usage${query}`, cookie ? { cookie } : {}))

describe('GET /api/admin/ai/usage', () => {
  test('401 when signed out, 403 for a buyer', async () => {
    expect((await usage('')).status).toBe(401)
    const forbidden = await usage('', buyerCookie)
    expect(forbidden.status).toBe(403)
    expect(await forbidden.json()).toEqual({
      error: 'This needs an administrator account',
    })
  })

  test('adds up calls, failures, tokens, and cost per India day and feature', async () => {
    const response = await usage('?from=2026-09-01&to=2026-09-02', adminCookie)
    expect(response.status).toBe(200)
    const report = await response.json()
    expect(report).toMatchObject({ from: '2026-09-01', to: '2026-09-02' })
    expect(report.lines).toEqual([
      {
        date: '2026-09-02',
        feature: 'listing_draft',
        calls: 2,
        failedCalls: 1,
        inputTokens: 1300,
        outputTokens: 200,
        costMicroUsd: 315,
      },
      {
        date: '2026-09-02',
        feature: 'nl_search',
        calls: 1,
        failedCalls: 0,
        inputTokens: 80,
        outputTokens: 20,
        costMicroUsd: null,
      },
      {
        date: '2026-09-01',
        feature: 'nl_search',
        calls: 1,
        failedCalls: 0,
        inputTokens: 1000,
        outputTokens: 200,
        costMicroUsd: 270,
      },
    ])
  })

  test('shows today’s calls next to the platform limit, over the last 30 days by default', async () => {
    const report = await (await usage('', adminCookie)).json()
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
    }).format(new Date())
    expect(report.to).toBe(today)
    expect(report.today.date).toBe(today)
    expect(report.today.platformCalls).toBeGreaterThanOrEqual(1)
    expect(report.today.platformLimit).toBe(2000)
    const days =
      (Date.parse(report.to) - Date.parse(report.from)) / 86_400_000 + 1
    expect(days).toBe(30)
  })

  test.each([
    ['?from=2026-9-1', 'from must be a date like 2026-10-11'],
    ['?to=2026-02-30', 'to must be a real date'],
    ['?from=2026-09-10&to=2026-09-01', 'from must not be after to'],
    ['?from=2026-01-01&to=2026-09-01', 'the report can cover at most 92 days'],
  ])('400 for %s', async (query, issue) => {
    const response = await usage(query, adminCookie)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'The report dates are not valid',
      issues: [issue],
    })
  })
})
