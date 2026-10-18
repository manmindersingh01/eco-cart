import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import { auditLogs, coupons, orders } from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import { ForbiddenError, NotFoundError } from '../../errors.ts'
import { validationIssues } from '../../testing/errors.ts'
import {
  createTestCategory,
  createTestCoupon,
  createTestOrderWithLines,
  createTestProduct,
  createTestSeller,
  createTestUser,
} from '../../testing/fixtures.ts'
import {
  couponProblem,
  createCoupon,
  findCouponByCode,
  getCoupon,
  listCoupons,
  updateCoupon,
} from './coupons.ts'

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'coupons-test')
  pools.push(pool)
  return createDatabase(pool)
}
const web = connect(requireEnv('DATABASE_URL'))
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))

let admin: Extract<RequestContext, { role: 'admin' }>

beforeAll(async () => {
  const user = await createTestUser(owner, 'admin')
  admin = { role: 'admin', userId: user.id }
})

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()))
})

/** Letters and digits only, so codes built from it stay valid. */
const tag = () => randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()

const create = (input: unknown, context: RequestContext = admin) =>
  withContext(web, context, (tx) => createCoupon(tx, context, input))
const update = (id: string, input: unknown, context: RequestContext = admin) =>
  withContext(web, context, (tx) => updateCoupon(tx, context, id, input))

const auditFor = (couponId: string) =>
  owner
    .select({
      action: auditLogs.action,
      actorUserId: auditLogs.actorUserId,
      before: auditLogs.before,
      after: auditLogs.after,
    })
    .from(auditLogs)
    .where(
      and(eq(auditLogs.entityType, 'coupon'), eq(auditLogs.entityId, couponId)),
    )
    .orderBy(auditLogs.id)

// Far in the future, so no case depends on today's date.
const diwali = (code: string) => ({
  code,
  description: 'Diwali sale',
  discountType: 'percent',
  discountValue: 1_500,
  minOrderPaise: 99_900,
  maxDiscountPaise: 30_000,
  usageLimit: 1_000,
  perUserLimit: 1,
  startsAt: '2099-10-20T00:00:00+05:30',
  endsAt: '2099-11-05T00:00:00+05:30',
})

describe('createCoupon', () => {
  test('stores the code in capitals and records the coupon', async () => {
    const code = `diwali${tag()}`
    const coupon = await create(diwali(` ${code} `))
    expect(coupon).toMatchObject({
      code: code.toUpperCase(),
      discountType: 'percent',
      discountValue: 1_500,
      usedCount: 0,
      isActive: true,
      createdBy: admin.userId,
      startsAt: new Date('2099-10-19T18:30:00.000Z'),
    })
    const [entry] = await auditFor(coupon.id)
    expect(entry).toMatchObject({
      action: 'coupon.create',
      actorUserId: admin.userId,
      after: expect.objectContaining({ code: code.toUpperCase() }),
    })
  })

  test('fills in the defaults: from now, no end, no limits', async () => {
    const before = Date.now()
    const coupon = await create({
      code: `FLAT${tag()}`,
      discountType: 'fixed',
      discountValue: 10_000,
      minOrderPaise: 49_900,
    })
    expect(coupon).toMatchObject({
      description: '',
      maxDiscountPaise: null,
      usageLimit: null,
      perUserLimit: null,
      endsAt: null,
    })
    expect(coupon.startsAt.getTime()).toBeGreaterThanOrEqual(before - 1000)
  })

  test.each<[string, Record<string, unknown>, string[]]>([
    [
      'a code with spaces',
      { code: 'DIWALI 25' },
      ['code must be 3 to 20 letters or digits, like DIWALI25'],
    ],
    [
      'a percent over 100%',
      { discountValue: 10_001 },
      ['discountValue must be at most 10000 (100%) for a percent coupon'],
    ],
    [
      'a fixed coupon with a maximum',
      { discountType: 'fixed', discountValue: 10_000, minOrderPaise: 50_000 },
      ['maxDiscountPaise is only for percent coupons'],
    ],
    [
      'a fixed coupon that could make an order free',
      {
        discountType: 'fixed',
        discountValue: 50_000,
        minOrderPaise: 50_000,
        maxDiscountPaise: null,
      },
      [
        'minOrderPaise must be more than the discount of a fixed coupon, so no order is free',
      ],
    ],
    [
      'an end before the start',
      { endsAt: '2099-10-19T00:00:00+05:30' },
      ['endsAt must be after startsAt'],
    ],
    [
      'an end in the past',
      {
        startsAt: '2026-01-01T00:00:00+05:30',
        endsAt: '2026-02-01T00:00:00+05:30',
      },
      ['endsAt must be in the future'],
    ],
    [
      'a date without its time zone',
      { startsAt: '2026-10-20' },
      ['startsAt must be a date and time, like 2026-10-20T00:00:00+05:30'],
    ],
    [
      'an unknown discount type',
      { discountType: 'bogo' },
      ['discountType must be one of percent, fixed'],
    ],
    [
      'a zero usage limit',
      { usageLimit: 0 },
      ['usageLimit must be at least 1'],
    ],
  ])('refuses %s', async (_case, overrides, issues) => {
    expect(
      await validationIssues(create({ ...diwali(`X${tag()}`), ...overrides })),
    ).toEqual(issues)
  })

  test('refuses a code that is taken, ignoring capital letters', async () => {
    const code = `TAKEN${tag()}`
    await create(diwali(code))
    expect(await validationIssues(create(diwali(code.toLowerCase())))).toEqual([
      'code is already used by another coupon',
    ])
  })
})

describe('updateCoupon', () => {
  test('changes only the fields sent, and records old and new values', async () => {
    const coupon = await create(diwali(`EDIT${tag()}`))
    const changed = await update(coupon.id, {
      isActive: false,
      maxDiscountPaise: 50_000,
    })
    expect(changed).toMatchObject({
      isActive: false,
      maxDiscountPaise: 50_000,
      discountValue: 1_500,
    })
    const entries = await auditFor(coupon.id)
    expect(entries.at(-1)).toEqual({
      action: 'coupon.update',
      actorUserId: admin.userId,
      before: { isActive: true, maxDiscountPaise: 30_000 },
      after: { isActive: false, maxDiscountPaise: 50_000 },
    })
  })

  test('checks the rules on the coupon as it would be saved', async () => {
    const coupon = await create(diwali(`RULE${tag()}`))
    expect(
      await validationIssues(update(coupon.id, { discountType: 'fixed' })),
    ).toEqual(['maxDiscountPaise is only for percent coupons'])
    expect(
      await validationIssues(
        update(coupon.id, {
          discountType: 'fixed',
          discountValue: 99_900,
          maxDiscountPaise: null,
        }),
      ),
    ).toEqual([
      'minOrderPaise must be more than the discount of a fixed coupon, so no order is free',
    ])
    expect(
      await validationIssues(
        update(coupon.id, { endsAt: '2099-10-01T00:00:00+05:30' }),
      ),
    ).toEqual(['endsAt must be after startsAt'])
  })

  test('refuses a usage limit below the uses so far', async () => {
    const coupon = await create(diwali(`USED${tag()}`))
    await owner
      .update(coupons)
      .set({ usedCount: 12 })
      .where(eq(coupons.id, coupon.id))
    expect(
      await validationIssues(update(coupon.id, { usageLimit: 11 })),
    ).toEqual([
      'usageLimit cannot be below the 12 times the coupon has been used',
    ])
    expect(await update(coupon.id, { usageLimit: 12 })).toMatchObject({
      usageLimit: 12,
    })
  })

  test('keeps the code, and refuses an empty change', async () => {
    const coupon = await create(diwali(`KEEP${tag()}`))
    expect(
      await validationIssues(update(coupon.id, { code: 'OTHER' })),
    ).toEqual(['code cannot be changed; create a new coupon instead'])
    await expect(update(coupon.id, {})).rejects.toThrow(
      'There is nothing to change',
    )
    await expect(update(randomUUID(), { isActive: false })).rejects.toThrow(
      NotFoundError,
    )
    await expect(update('nope', { isActive: false })).rejects.toThrow(
      NotFoundError,
    )
  })
})

describe('reading coupons', () => {
  test('lists every coupon newest first, a page at a time', async () => {
    const first = await create(diwali(`PAGEA${tag()}`))
    const second = await create(diwali(`PAGEB${tag()}`))
    const page = await withContext(web, admin, (tx) =>
      listCoupons(tx, admin, { limit: 1 }),
    )
    expect(page.items.map((coupon) => coupon.id)).toEqual([second.id])
    const next = await withContext(web, admin, (tx) =>
      listCoupons(tx, admin, { limit: 1, cursor: page.nextCursor! }),
    )
    expect(next.items.map((coupon) => coupon.id)).toEqual([first.id])
    expect(
      await withContext(web, admin, (tx) => getCoupon(tx, admin, first.id)),
    ).toEqual(first)
  })

  test.each<[string, RequestContext]>([
    ['a buyer', { role: 'buyer', userId: randomUUID() }],
    [
      'a seller',
      { role: 'seller', userId: randomUUID(), sellerId: randomUUID() },
    ],
    ['the system', { role: 'system' }],
    ['a visitor', { role: 'anonymous' }],
  ])('is for administrators only, not %s', async (_who, context) => {
    const refused = new ForbiddenError('Only administrators can manage coupons')
    await expect(create(diwali(`NO${tag()}`), context)).rejects.toThrow(refused)
    await expect(update(randomUUID(), {}, context)).rejects.toThrow(refused)
    await expect(
      withContext(web, context, (tx) => listCoupons(tx, context)),
    ).rejects.toThrow(refused)
    await expect(
      withContext(web, context, (tx) => getCoupon(tx, context, randomUUID())),
    ).rejects.toThrow(refused)
  })
})

/** Why a new coupon with `overrides` cannot be used, as a visitor. */
const problem = async (
  overrides: Parameters<typeof createTestCoupon>[2],
  options: { subtotalPaise?: number; userId?: string; now?: Date } = {},
) => {
  const coupon = await createTestCoupon(owner, admin.userId, overrides)
  return withContext(web, { role: 'anonymous' }, (tx) =>
    couponProblem(tx, coupon, {
      subtotalPaise: options.subtotalPaise ?? 100_000,
      userId: options.userId,
      ...(options.now ? { now: options.now } : {}),
    }),
  )
}

describe('couponProblem', () => {
  test('says nothing when the coupon can be used', async () => {
    expect(await problem({})).toBeNull()
  })

  test.each<[string, Parameters<typeof createTestCoupon>[2], string]>([
    ['switched off', { isActive: false }, 'This coupon is no longer active'],
    [
      'not started',
      { startsAt: new Date('2099-01-01T00:00:00+05:30') },
      'This coupon can be used from 1 Jan 2099',
    ],
    [
      'over',
      {
        startsAt: new Date('2026-01-01T00:00:00Z'),
        endsAt: new Date('2026-02-01T00:00:00Z'),
      },
      'This coupon has expired',
    ],
    [
      'used up',
      { usageLimit: 5, usedCount: 5 },
      'This coupon has been used up',
    ],
    [
      'below its minimum order',
      { minOrderPaise: 150_000 },
      'This coupon needs items worth at least ₹1,500; add ₹500 more',
    ],
  ])('explains a coupon that is %s', async (_case, overrides, message) => {
    expect(await problem(overrides)).toBe(message)
  })

  test("counts a buyer's orders against the per-buyer limit, not cancelled ones", async () => {
    const buyer = await createTestUser(owner)
    const { seller } = await createTestSeller(owner)
    const category = await createTestCategory(owner)
    const { product, variant } = await createTestProduct(owner, {
      sellerId: seller.id,
      categoryId: category.id,
    })
    const coupon = await createTestCoupon(owner, admin.userId, {
      perUserLimit: 1,
    })
    const order = async (status: 'confirmed' | 'cancelled') => {
      const made = await createTestOrderWithLines(owner, {
        buyerId: buyer.id,
        status,
        lines: [
          { sellerId: seller.id, productId: product.id, variantId: variant.id },
        ],
      })
      await owner
        .update(orders)
        .set({ couponId: coupon.id, couponCode: coupon.code })
        .where(eq(orders.id, made.order.id))
    }
    const asBuyer = () =>
      withContext(web, { role: 'buyer', userId: buyer.id }, (tx) =>
        couponProblem(tx, coupon, {
          subtotalPaise: 100_000,
          userId: buyer.id,
        }),
      )

    await order('cancelled')
    expect(await asBuyer()).toBeNull()
    await order('confirmed')
    expect(await asBuyer()).toBe('You have already used this coupon')
  })

  test('finds a coupon by its code, ignoring capital letters', async () => {
    const coupon = await createTestCoupon(owner, admin.userId)
    const found = await withContext(web, { role: 'anonymous' }, (tx) =>
      findCouponByCode(tx, ` ${coupon.code.toLowerCase()} `),
    )
    expect(found?.id).toBe(coupon.id)
  })
})
