import { and, desc, eq, gt } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import { auditLogs, platformSettings } from '../../db/schema/index.ts'
import { DEVELOPMENT_SETTINGS, seedDevelopmentData } from '../../db/seed.ts'
import { requireEnv } from '../../env.ts'
import {
  ForbiddenError,
  NotConfiguredError,
  NotFoundError,
  ValidationError,
} from '../../errors.ts'
import { createTestUser } from '../../testing/fixtures.ts'
import { getSetting, listSettings, updateSetting } from './service.ts'

/*
 * Settings are platform-wide, so this file owns platform_settings: it is the
 * only test file that writes the table, and it empties it before each test.
 */

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'settings-test')
  pools.push(pool)
  return createDatabase(pool)
}
const web = connect(requireEnv('DATABASE_URL'))
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))

let admin: RequestContext & { role: 'admin' }

beforeAll(async () => {
  const user = await createTestUser(owner, 'admin')
  admin = { role: 'admin', userId: user.id }
})

// audit_logs is append only, so each test looks only at entries written
// after it started.
let auditMark = 0

beforeEach(async () => {
  await owner.delete(platformSettings)
  const [last] = await owner
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .orderBy(desc(auditLogs.id))
    .limit(1)
  auditMark = last?.id ?? 0
})

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()))
})

const read = (key: Parameters<typeof getSetting>[1]) =>
  withContext(web, { role: 'anonymous' }, (tx) => getSetting(tx, key))

const save = (context: RequestContext, key: string, value: unknown) =>
  withContext(web, context, (tx) =>
    updateSetting(tx, context, key, value, '203.0.113.5'),
  )

const auditFor = (key: string) =>
  owner
    .select({
      actorUserId: auditLogs.actorUserId,
      actorRole: auditLogs.actorRole,
      before: auditLogs.before,
      after: auditLogs.after,
      ip: auditLogs.ip,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.entityType, 'platform_setting'),
        eq(auditLogs.entityId, key),
        gt(auditLogs.id, auditMark),
      ),
    )
    .orderBy(auditLogs.id)

/** The reasons a save was refused; fails the test if it was not refused. */
async function validationIssues(attempt: Promise<unknown>): Promise<string[]> {
  const error = await attempt.then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof ValidationError)) {
    throw new Error(`Expected a ValidationError, got ${String(error)}`)
  }
  return error.issues
}

const company = {
  legalName: 'Green Basket Private Limited',
  displayName: 'EcoKart',
  gstin: '29AABCG1234K1Z9',
  pan: 'AABCG1234K',
  address: {
    line1: '21 Residency Road',
    line2: null,
    city: 'Bengaluru',
    stateCode: '29',
    pincode: '560025',
  },
  supportEmail: 'help@ecokart.test',
  supportPhone: '+918012345678',
  grievanceOfficer: {
    name: 'Priya Nair',
    email: 'grievance@ecokart.test',
    phone: '+918012345679',
  },
}

describe('getSetting', () => {
  test('uses the default where one exists', async () => {
    expect(await read('cod_enabled')).toBe(true)
    expect(await read('payment_timeout_minutes')).toBe(30)
    expect(await read('prohibited_terms')).toEqual([])
  })

  test('refuses a setting the client must decide, until it is saved', async () => {
    await expect(read('commission_bps')).rejects.toThrow(NotConfiguredError)
    await save(admin, 'commission_bps', 1000)
    expect(await read('commission_bps')).toBe(1000)
  })

  test('refuses a saved value that breaks the rule', async () => {
    // Only someone editing the table by hand could do this.
    await owner
      .insert(platformSettings)
      .values({ key: 'delivery_charge_paise', value: 'forty-nine' })
    await expect(read('delivery_charge_paise')).rejects.toThrow(
      'The saved value of delivery_charge_paise is invalid',
    )
  })
})

describe('updateSetting', () => {
  test('saves the value and audits the old and new value', async () => {
    await save(admin, 'commission_bps', 1000)
    await save(admin, 'commission_bps', 1250)

    expect(await read('commission_bps')).toBe(1250)
    expect(await auditFor('commission_bps')).toEqual([
      {
        actorUserId: admin.userId,
        actorRole: 'admin',
        before: null,
        after: 1000,
        ip: '203.0.113.5',
      },
      {
        actorUserId: admin.userId,
        actorRole: 'admin',
        before: 1000,
        after: 1250,
        ip: '203.0.113.5',
      },
    ])
  })

  test('records who changed it last', async () => {
    const view = await save(admin, 'cod_enabled', false)
    expect(view).toMatchObject({
      key: 'cod_enabled',
      value: false,
      source: 'saved',
      updatedBy: admin.userId,
    })
  })

  test.each<[string, RequestContext]>([
    ['a buyer', { role: 'buyer', userId: crypto.randomUUID() }],
    [
      'a seller',
      {
        role: 'seller',
        userId: crypto.randomUUID(),
        sellerId: crypto.randomUUID(),
      },
    ],
    ['a visitor', { role: 'anonymous' }],
  ])('refuses %s, and saves nothing', async (_who, context) => {
    await expect(save(context, 'commission_bps', 0)).rejects.toThrow(
      ForbiddenError,
    )
    expect(await owner.select().from(platformSettings)).toEqual([])
  })

  test('refuses an unknown setting', async () => {
    await expect(save(admin, 'free_shipping_for_all', true)).rejects.toThrow(
      NotFoundError,
    )
  })

  test.each<[string, unknown]>([
    ['commission_bps', 10_001],
    ['commission_bps', -1],
    ['commission_bps', 10.5],
    ['commission_bps', '1000'],
    ['delivery_charge_paise', -100],
    ['delivery_charge_paise', 49.5],
    ['free_delivery_threshold_paise', null],
    ['cod_enabled', 'yes'],
    ['payment_timeout_minutes', 4],
    ['payment_timeout_minutes', 121],
    ['ai_daily_limit_seller', -1],
    ['prohibited_terms', ['ivory', '']],
    ['prohibited_terms', 'ivory'],
    ['prohibited_terms', Array.from({ length: 501 }, (_, i) => `term ${i}`)],
    ['company_details', { ...company, gstin: '29AABCG1234K1Z' }],
    ['company_details', { ...company, pan: 'AABCG9999K' }],
    ['company_details', { ...company, supportPhone: '08012345678' }],
    ['company_details', { ...company, grievanceOfficer: undefined }],
    ['company_details', { ...company, website: 'https://ecokart.test' }],
  ])('refuses %s = %j', async (key, value) => {
    expect(
      (await validationIssues(save(admin, key, value))).length,
    ).toBeGreaterThan(0)
  })

  test('explains what is wrong in plain words', async () => {
    expect(
      await validationIssues(
        save(admin, 'company_details', { ...company, pan: 'AABCG9999K' }),
      ),
    ).toEqual(['gstin must contain the PAN as its 3rd to 12th characters'])
  })

  test('accepts full company details', async () => {
    await save(admin, 'company_details', company)
    expect(await read('company_details')).toEqual(company)
  })

  test('stores prohibited terms in lower case, without duplicates', async () => {
    await save(admin, 'prohibited_terms', [
      'Ivory',
      ' ivory ',
      'Tiger skin',
      'tiger SKIN',
    ])
    expect(await read('prohibited_terms')).toEqual(['ivory', 'tiger skin'])
  })
})

describe('listSettings', () => {
  test('shows each setting with where its value comes from', async () => {
    await save(admin, 'commission_bps', 1000)
    const settings = await withContext(web, admin, (tx) =>
      listSettings(tx, admin),
    )
    const byKey = new Map(settings.map((setting) => [setting.key, setting]))

    expect(byKey.get('commission_bps')).toMatchObject({
      value: 1000,
      source: 'saved',
      updatedBy: admin.userId,
    })
    expect(byKey.get('cod_enabled')).toMatchObject({
      value: true,
      source: 'default',
      updatedAt: null,
    })
    expect(byKey.get('delivery_charge_paise')).toMatchObject({
      value: null,
      source: 'missing',
    })
    expect(settings.every((setting) => setting.description.length > 0)).toBe(
      true,
    )
  })

  test('is for administrators only', async () => {
    const buyer: RequestContext = { role: 'buyer', userId: admin.userId }
    await expect(
      withContext(web, buyer, (tx) => listSettings(tx, buyer)),
    ).rejects.toThrow(ForbiddenError)
  })
})

describe('seedDevelopmentData', () => {
  test('fills only the missing example values, as the system', async () => {
    await save(admin, 'commission_bps', 1500)

    const { settings: filled } = await seedDevelopmentData(web, {
      NODE_ENV: 'development',
    })

    expect(filled).toEqual([
      'delivery_charge_paise',
      'free_delivery_threshold_paise',
      'company_details',
    ])
    expect(await read('commission_bps')).toBe(1500)
    expect(await read('delivery_charge_paise')).toBe(
      DEVELOPMENT_SETTINGS.delivery_charge_paise,
    )
    expect(await auditFor('delivery_charge_paise')).toEqual([
      expect.objectContaining({ actorUserId: null, actorRole: 'system' }),
    ])
    expect(
      (await seedDevelopmentData(web, { NODE_ENV: 'development' })).settings,
    ).toEqual([])
  })

  test('refuses to run in production', async () => {
    await expect(
      seedDevelopmentData(web, { NODE_ENV: 'production' }),
    ).rejects.toThrow('The development seed never runs in production')
    expect(await owner.select().from(platformSettings)).toEqual([])
  })
})
