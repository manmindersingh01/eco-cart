import { createDatabase, createPool, requireEnv, schema } from '@ecokart/core'
import { createTestUser } from '@ecokart/core/testing'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { closePool } from '@/lib/db'
import { closeJobQueue } from '@/lib/queue'
import { signInWithEmail } from '@/testing/sign-in'
import { PUT } from './[key]/route'
import { GET } from './route'

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'settings-route-test',
)
const owner = createDatabase(ownerPool)
const base = 'http://localhost:3000/api/admin/settings'

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

const list = (cookie?: string) =>
  GET(new Request(base, { headers: cookie ? { cookie } : {} }))

const put = (key: string, body: string, cookie?: string) =>
  PUT(
    new Request(`${base}/${key}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.20',
        ...(cookie ? { cookie } : {}),
      },
      body,
    }),
    { params: Promise.resolve({ key }) },
  )

describe('GET /api/admin/settings', () => {
  test('401 when signed out, 403 for a buyer', async () => {
    expect((await list()).status).toBe(401)
    const forbidden = await list(buyerCookie)
    expect(forbidden.status).toBe(403)
    expect(await forbidden.json()).toEqual({
      error: 'This needs an administrator account',
    })
  })

  test('lists every setting for an administrator', async () => {
    const response = await list(adminCookie)
    expect(response.status).toBe(200)
    const { settings } = z
      .object({
        settings: z.array(z.object({ key: z.string(), source: z.string() })),
      })
      .parse(await response.json())
    expect(settings.map((setting) => setting.key)).toEqual([
      'commission_bps',
      'delivery_charge_paise',
      'free_delivery_threshold_paise',
      'cod_enabled',
      'payment_timeout_minutes',
      'ai_daily_limit_platform',
      'ai_daily_limit_seller',
      'prohibited_terms',
      'company_details',
    ])
    expect(settings.find((s) => s.key === 'cod_enabled')?.source).toBe(
      'default',
    )
  })
})

describe('PUT /api/admin/settings/{key}', () => {
  test('saves a setting and audits who changed it', async () => {
    const response = await put(
      'delivery_charge_paise',
      JSON.stringify({ value: 4900 }),
      adminCookie,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      setting: { key: 'delivery_charge_paise', value: 4900, source: 'saved' },
    })

    const [audit] = await owner
      .select({ action: schema.auditLogs.action, ip: schema.auditLogs.ip })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityType, 'platform_setting'),
          eq(schema.auditLogs.entityId, 'delivery_charge_paise'),
        ),
      )
    expect(audit).toEqual({ action: 'settings.update', ip: '203.0.113.20' })
  })

  test('400 with the reason for a value that breaks the rule', async () => {
    const response = await put(
      'commission_bps',
      JSON.stringify({ value: 25_000 }),
      adminCookie,
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'That value is not allowed for commission_bps',
      issues: [expect.stringContaining('10000')],
    })
  })

  test('400 for a body that is not JSON or has no value', async () => {
    expect((await put('cod_enabled', 'yes please', adminCookie)).status).toBe(
      400,
    )
    expect(
      (
        await put(
          'cod_enabled',
          JSON.stringify({ enabled: false }),
          adminCookie,
        )
      ).status,
    ).toBe(400)
  })

  test('404 for an unknown setting', async () => {
    const response = await put(
      'free_shipping_for_all',
      JSON.stringify({ value: true }),
      adminCookie,
    )
    expect(response.status).toBe(404)
  })

  test('403 for a buyer, and nothing is saved', async () => {
    const response = await put(
      'commission_bps',
      JSON.stringify({ value: 0 }),
      buyerCookie,
    )
    expect(response.status).toBe(403)
    const saved = await owner
      .select()
      .from(schema.platformSettings)
      .where(eq(schema.platformSettings.key, 'commission_bps'))
    expect(saved).toEqual([])
  })
})
