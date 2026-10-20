import { createDatabase, createPool, requireEnv } from '@ecokart/core'
import { createTestUser } from '@ecokart/core/testing'
import { afterAll, expect, test } from 'vitest'
import { z } from 'zod'
import { POST as approve } from '@/app/api/admin/sellers/[id]/approve/route'
import { POST as reject } from '@/app/api/admin/sellers/[id]/reject/route'
import { POST as suspend } from '@/app/api/admin/sellers/[id]/suspend/route'
import { GET as me } from '@/app/api/me/route'
import { GET as products } from '@/app/api/seller/products/route'
import { GET as documents } from '@/app/api/seller/documents/route'
import { closePool } from '@/lib/db'
import { closeJobQueue } from '@/lib/queue'
import { apiRequest as request, withId } from '@/testing/requests'
import { signInWithEmail } from '@/testing/sign-in'
import { GET, POST, PATCH } from './route'

const pool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'application-route-test',
)
const db = createDatabase(pool)
afterAll(async () => {
  await closeJobQueue()
  await closePool()
  await pool.end()
})
const details = {
  displayName: 'Test applicant',
  legalName: 'Test Business Limited',
  gstin: '27AAACE1234F1Z5',
  pan: 'AAACE1234F',
  line1: '1 Test Road',
  city: 'Pune',
  stateCode: '27',
  pincode: '411001',
  supportEmail: 'support@example.test',
  supportPhone: '+919800000000',
}
const view = z.object({
  application: z.object({
    id: z.string(),
    status: z.string(),
    rejectionReason: z.string().nullable(),
    displayName: z.string(),
  }),
})

test('S01 S02 I03 application ownership, input restrictions and pending applicant access', async () => {
  expect((await GET(request('/account/seller-application'))).status).toBe(401)
  const buyer = await createTestUser(db)
  const cookie = await signInWithEmail(db, buyer.email)
  expect(
    (await GET(request('/account/seller-application', { cookie }))).status,
  ).toBe(404)
  for (const body of [
    { ...details, commissionBps: 0 },
    { ...details, ownerUserId: buyer.id },
    { ...details, role: 'seller' },
    { ...details, stateCode: '29' },
    { ...details, pan: 'BBBCD1234F' },
  ])
    expect(
      (
        await POST(
          request('/account/seller-application', {
            cookie,
            method: 'POST',
            body,
          }),
        )
      ).status,
    ).toBe(400)
  const created = await POST(
    request('/account/seller-application', {
      cookie,
      method: 'POST',
      body: details,
    }),
  )
  expect(created.status).toBe(201)
  const first = view.parse(await created.json()).application
  expect(first.status).toBe('pending')
  expect(
    (
      await POST(
        request('/account/seller-application', {
          cookie,
          method: 'POST',
          body: details,
        }),
      )
    ).status,
  ).toBe(409)
  expect(
    (await documents(request('/seller/documents', { cookie }))).status,
  ).toBe(200)
  expect((await products(request('/seller/products', { cookie }))).status).toBe(
    403,
  )
  const changed = await PATCH(
    request('/account/seller-application', {
      cookie,
      method: 'PATCH',
      body: { displayName: 'Corrected application' },
    }),
  )
  expect(view.parse(await changed.json()).application.displayName).toBe(
    'Corrected application',
  )
  const other = await createTestUser(db)
  const otherCookie = await signInWithEmail(db, other.email)
  expect(
    (await GET(request('/account/seller-application', { cookie: otherCookie })))
      .status,
  ).toBe(404)
})

test('S07 I02 I04 rejection, resubmission, approval and suspension preserve buying', async () => {
  const buyer = await createTestUser(db)
  const admin = await createTestUser(db, 'admin')
  const cookie = await signInWithEmail(db, buyer.email)
  const adminCookie = await signInWithEmail(db, admin.email)
  const created = await POST(
    request('/account/seller-application', {
      cookie,
      method: 'POST',
      body: details,
    }),
  )
  const { id } = view.parse(await created.json()).application
  expect(
    (
      await reject(
        request(`/admin/sellers/${id}/reject`, {
          cookie: adminCookie,
          method: 'POST',
          body: { reason: 'Correct the business details' },
        }),
        withId(id),
      )
    ).status,
  ).toBe(200)
  expect(
    view.parse(
      await (
        await GET(request('/account/seller-application', { cookie }))
      ).json(),
    ).application,
  ).toMatchObject({
    status: 'rejected',
    rejectionReason: 'Correct the business details',
  })
  expect(
    (
      await POST(
        request('/account/seller-application', {
          cookie,
          method: 'POST',
          body: { ...details, displayName: 'Corrected business' },
        }),
      )
    ).status,
  ).toBe(201)
  expect(
    (
      await approve(
        request(`/admin/sellers/${id}/approve`, {
          cookie: adminCookie,
          method: 'POST',
        }),
        withId(id),
      )
    ).status,
  ).toBe(200)
  expect(await (await me(request('/me', { cookie }))).json()).toMatchObject({
    role: 'buyer',
    roles: ['buyer', 'seller'],
    sellerId: null,
  })
  expect((await products(request('/seller/products', { cookie }))).status).toBe(
    200,
  )
  expect(
    (
      await suspend(
        request(`/admin/sellers/${id}/suspend`, {
          cookie: adminCookie,
          method: 'POST',
          body: { reason: 'Test business review' },
        }),
        withId(id),
      )
    ).status,
  ).toBe(200)
  expect((await products(request('/seller/products', { cookie }))).status).toBe(
    403,
  )
  expect((await me(request('/me', { cookie }))).status).toBe(200)
  expect(
    view.parse(
      await (
        await GET(request('/account/seller-application', { cookie }))
      ).json(),
    ).application.status,
  ).toBe('suspended')
})
