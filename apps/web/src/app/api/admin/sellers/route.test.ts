import { createDatabase, createPool, requireEnv } from '@ecokart/core'
import { createTestUser } from '@ecokart/core/testing'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import {
  GET as getProfile,
  PATCH as patchProfile,
} from '@/app/api/seller/profile/route'
import { closePool } from '@/lib/db'
import { closeJobQueue } from '@/lib/queue'
import { apiRequest as request, withId } from '@/testing/requests'
import { signInWithEmail } from '@/testing/sign-in'
import { POST as approve } from './[id]/approve/route'
import { POST as reinstate } from './[id]/reinstate/route'
import { GET as getOne, PATCH as patchOne } from './[id]/route'
import { POST as suspend } from './[id]/suspend/route'
import { GET as list, POST as create } from './route'

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'sellers-route-test',
)
const owner = createDatabase(ownerPool)

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

const letters = () =>
  Array.from({ length: 6 }, () =>
    String.fromCharCode(65 + Math.floor(Math.random() * 26)),
  ).join('')

const newSellerBody = () => ({
  owner: {
    email: `${crypto.randomUUID()}@example.test`,
    name: 'Lakshmi Rao',
    phoneNumber: null,
  },
  displayName: `Bamboo Home ${letters()}`,
  legalName: 'Bamboo Home Crafts LLP',
  gstin: '29AACCB5678L1Z3',
  pan: 'AACCB5678L',
  line1: '5 Brigade Road',
  city: 'Bengaluru',
  stateCode: '29',
  pincode: '560001',
  supportEmail: 'care@bamboohome.test',
  supportPhone: '+918012340002',
  invoicePrefix: letters(),
  commissionBps: 800,
})

const sellerResponse = z.object({
  seller: z.object({ id: z.string(), status: z.string() }).loose(),
})

async function createVia(cookie: string) {
  const body = newSellerBody()
  const response = await create(
    request('/admin/sellers', { method: 'POST', cookie, body }),
  )
  return { body, response }
}

describe('seller onboarding through the API', () => {
  test('create, sign in, approve, edit, suspend, and reinstate', async () => {
    const { body, response } = await createVia(adminCookie)
    expect(response.status).toBe(201)
    const { seller } = sellerResponse.parse(await response.json())
    expect(seller.status).toBe('pending')

    // The owner signs in and sees their pending business.
    let sellerCookie = await signInWithEmail(owner, body.owner.email)
    const profile = await getProfile(
      request('/seller/profile', { cookie: sellerCookie }),
    )
    expect(profile.status).toBe(200)
    expect(sellerResponse.parse(await profile.json()).seller).toMatchObject({
      id: seller.id,
      status: 'pending',
    })

    const approved = await approve(
      request(`/admin/sellers/${seller.id}/approve`, {
        method: 'POST',
        cookie: adminCookie,
      }),
      withId(seller.id),
    )
    expect(sellerResponse.parse(await approved.json()).seller.status).toBe(
      'approved',
    )

    const contacts = await patchProfile(
      request('/seller/profile', {
        method: 'PATCH',
        cookie: sellerCookie,
        body: { supportPhone: '+919845012345' },
      }),
    )
    expect(contacts.status).toBe(200)
    const taxChange = await patchProfile(
      request('/seller/profile', {
        method: 'PATCH',
        cookie: sellerCookie,
        body: { gstin: '29AACCB5678L1Z3' },
      }),
    )
    expect(taxChange.status).toBe(400)

    const suspended = await suspend(
      request(`/admin/sellers/${seller.id}/suspend`, {
        method: 'POST',
        cookie: adminCookie,
        body: { reason: 'Customer complaints' },
      }),
      withId(seller.id),
    )
    expect(sellerResponse.parse(await suspended.json()).seller.status).toBe(
      'suspended',
    )
    // The owner's session ended with the suspension.
    expect(
      (await getProfile(request('/seller/profile', { cookie: sellerCookie })))
        .status,
    ).toBe(401)
    const approveSuspended = await approve(
      request(`/admin/sellers/${seller.id}/approve`, {
        method: 'POST',
        cookie: adminCookie,
      }),
      withId(seller.id),
    )
    expect(approveSuspended.status).toBe(409)

    await reinstate(
      request(`/admin/sellers/${seller.id}/reinstate`, {
        method: 'POST',
        cookie: adminCookie,
      }),
      withId(seller.id),
    )
    sellerCookie = await signInWithEmail(owner, body.owner.email)
    expect(
      (await getProfile(request('/seller/profile', { cookie: sellerCookie })))
        .status,
    ).toBe(200)
  })

  test('an administrator sees the owner account and edits details', async () => {
    const { body, response } = await createVia(adminCookie)
    const { seller } = sellerResponse.parse(await response.json())

    const detail = await getOne(
      request(`/admin/sellers/${seller.id}`, { cookie: adminCookie }),
      withId(seller.id),
    )
    expect(await detail.json()).toMatchObject({
      seller: { id: seller.id, owner: { email: body.owner.email } },
    })

    const edited = await patchOne(
      request(`/admin/sellers/${seller.id}`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { commissionBps: 900 },
      }),
      withId(seller.id),
    )
    expect(await edited.json()).toMatchObject({
      seller: { commissionBps: 900 },
    })
  })

  test('lists sellers by status, a page at a time', async () => {
    await createVia(adminCookie)
    const response = await list(
      request('/admin/sellers?status=pending&limit=1', { cookie: adminCookie }),
    )
    expect(response.status).toBe(200)
    const page = z
      .object({
        items: z.array(z.object({ status: z.string() }).loose()),
        nextCursor: z.string().nullable(),
      })
      .parse(await response.json())
    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.status).toBe('pending')

    const badCursor = await list(
      request('/admin/sellers?cursor=nonsense', { cookie: adminCookie }),
    )
    expect(badCursor.status).toBe(400)
  })
})

describe('refusals', () => {
  test('401 signed out, 403 for a buyer', async () => {
    expect((await list(request('/admin/sellers'))).status).toBe(401)
    const { response } = await createVia(buyerCookie)
    expect(response.status).toBe(403)
    expect(
      (await getProfile(request('/seller/profile', { cookie: buyerCookie })))
        .status,
    ).toBe(403)
  })

  test('400 with reasons for invalid details', async () => {
    const response = await create(
      request('/admin/sellers', {
        method: 'POST',
        cookie: adminCookie,
        body: { ...newSellerBody(), stateCode: '27' },
      }),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Those seller details are not valid',
      issues: ['gstin must start with the state code of the address (27)'],
    })
  })

  test('404 for a seller that does not exist', async () => {
    const id = crypto.randomUUID()
    const response = await getOne(
      request(`/admin/sellers/${id}`, { cookie: adminCookie }),
      withId(id),
    )
    expect(response.status).toBe(404)
  })
})
