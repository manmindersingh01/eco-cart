import { createDatabase, createPool, requireEnv } from '@ecokart/core'
import { createTestSeller, createTestUser } from '@ecokart/core/testing'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { closePool } from '@/lib/db'
import { closeJobQueue } from '@/lib/queue'
import { apiRequest as request, withId } from '@/testing/requests'
import { signInWithEmail } from '@/testing/sign-in'
import { DELETE as remove, GET as getOne, PATCH as patch } from './[id]/route'
import { POST as add, GET as list } from './route'

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'addresses-route-test',
)
const owner = createDatabase(ownerPool)

let buyerCookie: string
let otherBuyerCookie: string
let sellerCookie: string
let adminCookie: string

beforeAll(async () => {
  const [seller, admin] = await Promise.all([
    createTestSeller(owner),
    createTestUser(owner, 'admin'),
  ])
  ;[buyerCookie, otherBuyerCookie, sellerCookie, adminCookie] =
    await Promise.all([
      signInWithEmail(owner, `${crypto.randomUUID()}@example.test`),
      signInWithEmail(owner, `${crypto.randomUUID()}@example.test`),
      signInWithEmail(owner, seller.owner.email),
      signInWithEmail(owner, admin.email),
    ])
})

afterAll(async () => {
  await closeJobQueue()
  await closePool()
  await ownerPool.end()
})

const addressShape = z
  .object({
    id: z.string(),
    line1: z.string(),
    stateCode: z.string(),
    stateName: z.string(),
    isDefault: z.boolean(),
  })
  .loose()
const addressResponse = z.object({ address: addressShape })
const listResponse = z.object({ addresses: z.array(addressShape) })

const home = {
  fullName: 'Asha Patil',
  phone: '+919812345678',
  line1: '4 FC Road',
  line2: '',
  city: 'Pune',
  stateCode: '27',
  pincode: '411004',
}
const office = {
  fullName: 'Asha Patil',
  phone: '+919812345678',
  line1: '21 Residency Road',
  landmark: 'Opposite the Cathedral',
  city: 'Bengaluru',
  stateCode: '29',
  pincode: '560025',
}

const path = (id: string) => `/account/addresses/${id}`
const addVia = (body: unknown, cookie = buyerCookie) =>
  add(request('/account/addresses', { method: 'POST', cookie, body }))
const patchVia = (id: string, body: unknown, cookie = buyerCookie) =>
  patch(request(path(id), { method: 'PATCH', cookie, body }), withId(id))
const removeVia = (id: string, cookie = buyerCookie) =>
  remove(request(path(id), { method: 'DELETE', cookie }), withId(id))
const getVia = (id: string, cookie = buyerCookie) =>
  getOne(request(path(id), { cookie }), withId(id))
const bookOf = async (cookie = buyerCookie) =>
  listResponse
    .parse(await (await list(request('/account/addresses', { cookie }))).json())
    .addresses.map(
      (address) => `${address.line1}${address.isDefault ? ' (default)' : ''}`,
    )

describe('a buyer keeps their addresses through the API', () => {
  test('add, switch the default, edit, and delete', async () => {
    const first = await addVia(home)
    expect(first.status).toBe(201)
    const homeAddress = addressResponse.parse(await first.json()).address
    expect(homeAddress).toMatchObject({
      line1: '4 FC Road',
      line2: null,
      stateName: 'Maharashtra',
      isDefault: true,
    })

    const second = await addVia(office)
    expect(second.status).toBe(201)
    const officeAddress = addressResponse.parse(await second.json()).address
    expect(officeAddress).toMatchObject({
      stateName: 'Karnataka',
      isDefault: false,
    })

    const switched = await patchVia(officeAddress.id, { isDefault: true })
    expect(switched.status).toBe(200)
    expect(await bookOf()).toEqual(['21 Residency Road (default)', '4 FC Road'])

    const edited = await patchVia(homeAddress.id, { line1: '5 FC Road' })
    expect(addressResponse.parse(await edited.json()).address).toMatchObject({
      line1: '5 FC Road',
      isDefault: false,
    })
    const read = await getVia(homeAddress.id)
    expect(addressResponse.parse(await read.json()).address.line1).toBe(
      '5 FC Road',
    )

    const deleted = await removeVia(officeAddress.id)
    expect(deleted.status).toBe(204)
    expect(await bookOf()).toEqual(['5 FC Road (default)'])
    expect((await getVia(officeAddress.id)).status).toBe(404)
  })

  test('400 with the reasons, for a bad address or body', async () => {
    const response = await addVia({
      ...home,
      phone: '+14155550100',
      stateCode: '99',
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Those address details are not valid',
      issues: [
        'phone must be an Indian mobile number, like +919812345678',
        'stateCode must be a GST state code, like 27 for Maharashtra',
      ],
    })

    const notJson = await add(
      new Request('http://localhost:3000/api/account/addresses', {
        method: 'POST',
        headers: { cookie: buyerCookie },
        body: 'not json',
      }),
    )
    expect(notJson.status).toBe(400)

    const created = addressResponse.parse(
      await (await addVia(office, otherBuyerCookie)).json(),
    ).address
    const unset = await patchVia(
      created.id,
      { isDefault: false },
      otherBuyerCookie,
    )
    expect(unset.status).toBe(400)
    expect(await unset.json()).toEqual({
      error: 'Those address details are not valid',
      issues: [
        'isDefault can only be true; make another address the default instead',
      ],
    })
    expect((await patchVia(created.id, {}, otherBuyerCookie)).status).toBe(400)
  })

  test("404 for another buyer's address or a broken id", async () => {
    const created = addressResponse.parse(
      await (await addVia(office, otherBuyerCookie)).json(),
    ).address
    expect((await getVia(created.id)).status).toBe(404)
    expect((await patchVia(created.id, { city: 'Mysuru' })).status).toBe(404)
    expect((await removeVia(created.id)).status).toBe(404)
    expect((await getVia('not-an-id')).status).toBe(404)
    expect((await getVia(created.id, otherBuyerCookie)).status).toBe(200)
  })

  test('409 for an address over the limit', async () => {
    const cookie = await signInWithEmail(
      owner,
      `${crypto.randomUUID()}@example.test`,
    )
    for (let n = 0; n < 20; n += 1) {
      expect(
        (await addVia({ ...office, line1: `${n} MG Road` }, cookie)).status,
      ).toBe(201)
    }
    const over = await addVia(office, cookie)
    expect(over.status).toBe(409)
    expect(await over.json()).toEqual({
      error: 'You can save up to 20 addresses; delete one first',
    })
  })
})

describe('who may use the address book', () => {
  test('401 when signed out', async () => {
    expect((await list(request('/account/addresses'))).status).toBe(401)
    expect(
      (await add(request('/account/addresses', { method: 'POST', body: home })))
        .status,
    ).toBe(401)
    const id = crypto.randomUUID()
    expect(
      (
        await patch(
          request(path(id), { method: 'PATCH', body: {} }),
          withId(id),
        )
      ).status,
    ).toBe(401)
  })

  test.each([
    ['a seller', () => sellerCookie],
    ['an administrator', () => adminCookie],
  ])('403 for %s', async (_who, cookie) => {
    const listed = await list(
      request('/account/addresses', { cookie: cookie() }),
    )
    expect(listed.status).toBe(403)
    expect(await listed.json()).toEqual({ error: 'This needs a buyer account' })
    expect((await addVia(home, cookie())).status).toBe(403)
    const id = crypto.randomUUID()
    expect((await removeVia(id, cookie())).status).toBe(403)
  })
})
