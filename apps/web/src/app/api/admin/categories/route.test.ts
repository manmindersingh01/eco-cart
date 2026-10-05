import { createDatabase, createPool, requireEnv } from '@ecokart/core'
import { createTestUser } from '@ecokart/core/testing'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { GET as publicTree } from '@/app/api/categories/route'
import { closePool } from '@/lib/db'
import { closeJobQueue } from '@/lib/queue'
import { apiRequest as request, withId } from '@/testing/requests'
import { signInWithEmail } from '@/testing/sign-in'
import { DELETE as remove, PATCH as patch } from './[id]/route'
import { POST as create, GET as fullTree } from './route'

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'categories-route-test',
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

const categoryResponse = z.object({
  category: z.object({ id: z.string(), depth: z.number() }).loose(),
})

interface Node {
  id: string
  isActive?: boolean
  children: Node[]
}
const treeResponse = z.object({
  categories: z.array(z.custom<Node>()),
})
const findNode = (nodes: Node[], id: string): Node | undefined =>
  nodes.find((node) => node.id === id) ??
  nodes
    .map((node) => findNode(node.children, id))
    .find((node) => node !== undefined)

async function createVia(body: object, cookie = adminCookie) {
  return create(request('/admin/categories', { method: 'POST', cookie, body }))
}

async function created(body: object) {
  const response = await createVia(body)
  expect(response.status).toBe(201)
  return categoryResponse.parse(await response.json()).category
}

describe('category tree through the API', () => {
  test('build, move, deactivate, and delete', async () => {
    const top = await created({
      name: `Home ${crypto.randomUUID().slice(0, 8)}`,
      gstRateBps: 1800,
    })
    const middle = await created({
      name: 'Kitchen',
      parentId: top.id,
      gstRateBps: 1800,
    })
    const bottom = await created({
      name: 'Bottles',
      parentId: middle.id,
      gstRateBps: 500,
      defaultHsnCode: '7323',
    })
    expect(bottom.depth).toBe(2)

    const fourth = await createVia({
      name: 'Steel',
      parentId: bottom.id,
      gstRateBps: 500,
    })
    expect(fourth.status).toBe(400)
    expect(await fourth.json()).toEqual({
      error: 'Those category details are not valid',
      issues: [
        'parentId is already at the lowest level; categories go at most 3 levels deep',
      ],
    })

    // Bottles moves up next to Kitchen.
    const moved = await patch(
      request(`/admin/categories/${bottom.id}`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { parentId: top.id },
      }),
      withId(bottom.id),
    )
    expect(categoryResponse.parse(await moved.json()).category.depth).toBe(1)

    await patch(
      request(`/admin/categories/${middle.id}`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { isActive: false },
      }),
      withId(middle.id),
    )
    const visible = treeResponse.parse(await (await publicTree()).json())
    expect(
      findNode(visible.categories, top.id)?.children.map((c) => c.id),
    ).toEqual([bottom.id])
    const full = treeResponse.parse(
      await (
        await fullTree(request('/admin/categories', { cookie: adminCookie }))
      ).json(),
    )
    expect(findNode(full.categories, middle.id)?.isActive).toBe(false)

    const inUse = await remove(
      request(`/admin/categories/${top.id}`, {
        method: 'DELETE',
        cookie: adminCookie,
      }),
      withId(top.id),
    )
    expect(inUse.status).toBe(409)
    const deleted = await remove(
      request(`/admin/categories/${middle.id}`, {
        method: 'DELETE',
        cookie: adminCookie,
      }),
      withId(middle.id),
    )
    expect(deleted.status).toBe(204)
    expect(await deleted.text()).toBe('')
  })

  test('a rate removed by GST 2.0 is refused', async () => {
    const response = await createVia({ name: 'Clothing', gstRateBps: 1200 })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      issues: [
        expect.stringContaining(
          'gstRateBps must be one of the current GST rates',
        ),
      ],
    })
  })
})

describe('refusals', () => {
  test('401 signed out, 403 for a buyer', async () => {
    expect((await fullTree(request('/admin/categories'))).status).toBe(401)
    expect(
      (await createVia({ name: 'X', gstRateBps: 500 }, buyerCookie)).status,
    ).toBe(403)
  })

  test('404 for a category that does not exist', async () => {
    const id = crypto.randomUUID()
    const response = await patch(
      request(`/admin/categories/${id}`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { name: 'X' },
      }),
      withId(id),
    )
    expect(response.status).toBe(404)
  })

  test('400 for a body that is not JSON', async () => {
    const response = await create(
      new Request('http://localhost:3000/api/admin/categories', {
        method: 'POST',
        headers: { cookie: adminCookie },
        body: 'name=Home',
      }),
    )
    expect(response.status).toBe(400)
  })
})
