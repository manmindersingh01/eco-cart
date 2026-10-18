import { createDatabase, createPool, requireEnv } from '@ecokart/core'
import { createTestUser } from '@ecokart/core/testing'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { closePool } from '@/lib/db'
import { closeJobQueue } from '@/lib/queue'
import { apiRequest as request, withId } from '@/testing/requests'
import { signInWithEmail } from '@/testing/sign-in'
import { GET as getOne, PATCH as patch } from './[id]/route'
import { POST as create, GET as list } from './route'

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'coupons-route-test',
)
const owner = createDatabase(ownerPool)

let adminCookie: string
let buyerCookie: string

beforeAll(async () => {
  const admin = await createTestUser(owner, 'admin')
  ;[adminCookie, buyerCookie] = await Promise.all([
    signInWithEmail(owner, admin.email),
    signInWithEmail(owner, `${crypto.randomUUID()}@example.test`),
  ])
})

afterAll(async () => {
  await closeJobQueue()
  await closePool()
  await ownerPool.end()
})

const couponResponse = z.object({
  coupon: z
    .object({ id: z.string(), code: z.string(), isActive: z.boolean() })
    .loose(),
})
const pageResponse = z.object({
  items: z.array(z.object({ id: z.string() }).loose()),
  nextCursor: z.string().nullable(),
})

const code = () =>
  `API${crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`

const createVia = (body: unknown, cookie = adminCookie) =>
  create(request('/admin/coupons', { method: 'POST', cookie, body }))

describe('coupons through the API', () => {
  test('create, list, read, and switch off', async () => {
    const response = await createVia({
      code: code(),
      description: 'Flat ₹100 off',
      discountType: 'fixed',
      discountValue: 10_000,
      minOrderPaise: 49_900,
    })
    expect(response.status).toBe(201)
    const { coupon } = couponResponse.parse(await response.json())

    const page = pageResponse.parse(
      await (
        await list(request('/admin/coupons?limit=1', { cookie: adminCookie }))
      ).json(),
    )
    expect(page.items.map((item) => item.id)).toEqual([coupon.id])

    const read = await getOne(
      request(`/admin/coupons/${coupon.id}`, { cookie: adminCookie }),
      withId(coupon.id),
    )
    expect(couponResponse.parse(await read.json()).coupon).toEqual(coupon)

    const off = await patch(
      request(`/admin/coupons/${coupon.id}`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { isActive: false },
      }),
      withId(coupon.id),
    )
    expect(couponResponse.parse(await off.json()).coupon.isActive).toBe(false)
  })

  test('400 with the reasons, 404 for a missing coupon', async () => {
    const response = await createVia({
      code: 'no spaces',
      discountType: 'percent',
      discountValue: 20_000,
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Those coupon details are not valid',
      issues: ['code must be 3 to 20 letters or digits, like DIWALI25'],
    })
    const id = crypto.randomUUID()
    const missing = await getOne(
      request(`/admin/coupons/${id}`, { cookie: adminCookie }),
      withId(id),
    )
    expect(missing.status).toBe(404)
  })

  test('401 when signed out and 403 for a buyer', async () => {
    expect((await list(request('/admin/coupons'))).status).toBe(401)
    const refused = await createVia(
      { code: code(), discountType: 'percent', discountValue: 1_000 },
      buyerCookie,
    )
    expect(refused.status).toBe(403)
  })
})
