import { createDatabase, createPool, requireEnv } from '@ecokart/core'
import { createTestUser } from '@ecokart/core/testing'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { GET as publicList } from '@/app/api/brands/route'
import { closePool } from '@/lib/db'
import { closeJobQueue } from '@/lib/queue'
import { apiRequest as request, withId } from '@/testing/requests'
import { signInWithEmail } from '@/testing/sign-in'
import { DELETE as remove, PATCH as patch } from './[id]/route'
import { POST as create, GET as list } from './route'

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'brands-route-test',
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

const tag = () =>
  Array.from({ length: 8 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26)),
  ).join('')

const brandResponse = z.object({
  brand: z
    .object({ id: z.string(), name: z.string(), slug: z.string() })
    .loose(),
})
const pageResponse = z.object({
  items: z.array(z.object({ id: z.string(), name: z.string() }).loose()),
  nextCursor: z.string().nullable(),
})

const createVia = (body: object, cookie = adminCookie) =>
  create(request('/admin/brands', { method: 'POST', cookie, body }))

describe('brands through the API', () => {
  test('create, list A to Z, deactivate, and delete', async () => {
    const t = tag()
    for (const name of [`Terra ${t}`, `bamboo ${t}`]) {
      expect((await createVia({ name })).status).toBe(201)
    }
    const duplicate = await createVia({ name: `TERRA ${t}` })
    expect(duplicate.status).toBe(400)
    expect(await duplicate.json()).toEqual({
      error: 'Those brand details are not valid',
      issues: ['name is already used by another brand'],
    })

    const first = pageResponse.parse(
      await (await publicList(request(`/brands?q=${t}&limit=1`))).json(),
    )
    expect(first.items.map((b) => b.name)).toEqual([`bamboo ${t}`])
    const second = pageResponse.parse(
      await (
        await publicList(
          request(`/brands?q=${t}&limit=1&cursor=${first.nextCursor}`),
        )
      ).json(),
    )
    expect(second).toEqual({
      items: [expect.objectContaining({ name: `Terra ${t}` })],
      nextCursor: null,
    })

    const terra = second.items[0]!
    const deactivated = await patch(
      request(`/admin/brands/${terra.id}`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { isActive: false },
      }),
      withId(terra.id),
    )
    expect(brandResponse.parse(await deactivated.json()).brand).toMatchObject({
      isActive: false,
    })
    const visible = pageResponse.parse(
      await (await publicList(request(`/brands?q=${t}`))).json(),
    )
    expect(visible.items.map((b) => b.name)).toEqual([`bamboo ${t}`])
    const all = pageResponse.parse(
      await (
        await list(request(`/admin/brands?q=${t}`, { cookie: adminCookie }))
      ).json(),
    )
    expect(all.items.map((b) => b.name)).toEqual([`bamboo ${t}`, `Terra ${t}`])

    const deleted = await remove(
      request(`/admin/brands/${terra.id}`, {
        method: 'DELETE',
        cookie: adminCookie,
      }),
      withId(terra.id),
    )
    expect(deleted.status).toBe(204)
  })

  test('400 for a broken cursor or limit', async () => {
    expect((await publicList(request('/brands?cursor=nonsense'))).status).toBe(
      400,
    )
    expect((await publicList(request('/brands?limit=many'))).status).toBe(400)
  })
})

describe('refusals', () => {
  test('401 signed out, 403 for a buyer', async () => {
    expect((await list(request('/admin/brands'))).status).toBe(401)
    expect((await createVia({ name: `X ${tag()}` }, buyerCookie)).status).toBe(
      403,
    )
  })

  test('404 for a brand that does not exist', async () => {
    const id = crypto.randomUUID()
    const response = await remove(
      request(`/admin/brands/${id}`, { method: 'DELETE', cookie: adminCookie }),
      withId(id),
    )
    expect(response.status).toBe(404)
  })
})
