import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import { auditLogs } from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import { ConflictError, ForbiddenError, NotFoundError } from '../../errors.ts'
import { encodeCursor } from '../../lib/pagination.ts'
import {
  createTestCategory,
  createTestProduct,
  createTestSeller,
  createTestUser,
} from '../../testing/fixtures.ts'
import { validationIssues } from '../../testing/errors.ts'
import {
  createBrand,
  deleteBrand,
  listAllBrands,
  listBrands,
  updateBrand,
} from './brands.ts'
import type { BrandListOptions } from './types.ts'

/*
 * Other test files add brands too, so every name here carries a unique tag,
 * and lists are searched by that tag.
 */

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'brands-test')
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

/** Letters only, so names and slugs built from it stay predictable. */
const tag = () =>
  Array.from({ length: 8 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26)),
  ).join('')

const create = (input: unknown, context: RequestContext = admin) =>
  withContext(web, context, (tx) => createBrand(tx, context, input))
const update = (id: string, input: unknown, context: RequestContext = admin) =>
  withContext(web, context, (tx) => updateBrand(tx, context, id, input))
const remove = (id: string, context: RequestContext = admin) =>
  withContext(web, context, (tx) => deleteBrand(tx, context, id))
const publicList = (options: BrandListOptions) =>
  withContext(web, { role: 'anonymous' }, (tx) => listBrands(tx, options))
const adminList = (options: BrandListOptions) =>
  withContext(web, admin, (tx) => listAllBrands(tx, admin, options))

const auditFor = (brandId: string) =>
  owner
    .select({
      action: auditLogs.action,
      actorUserId: auditLogs.actorUserId,
      before: auditLogs.before,
      after: auditLogs.after,
    })
    .from(auditLogs)
    .where(
      and(eq(auditLogs.entityType, 'brand'), eq(auditLogs.entityId, brandId)),
    )
    .orderBy(auditLogs.id)

describe('createBrand', () => {
  test('makes the slug from the name and records the brand', async () => {
    const t = tag()
    const brand = await create({ name: `Bamboo & Co ${t}` })
    expect(brand).toMatchObject({
      name: `Bamboo & Co ${t}`,
      slug: `bamboo-and-co-${t}`,
      isActive: true,
    })
    expect(await auditFor(brand.id)).toEqual([
      {
        action: 'brand.create',
        actorUserId: admin.userId,
        before: null,
        after: {
          id: brand.id,
          name: brand.name,
          slug: brand.slug,
          isActive: true,
        },
      },
    ])
  })

  test('refuses a name that exists, ignoring capital letters', async () => {
    const name = `Khadi Threads ${tag()}`
    await create({ name })
    expect(
      await validationIssues(create({ name: name.toUpperCase() })),
    ).toEqual(['name is already used by another brand'])
  })

  test('numbers a taken slug, and refuses a chosen slug that is taken', async () => {
    const t = tag()
    const first = await create({ name: `Terra ${t}.` })
    const second = await create({ name: `Terra ${t}` })
    expect([first.slug, second.slug]).toEqual([`terra-${t}`, `terra-${t}-2`])
    expect(
      await validationIssues(create({ name: `Other ${t}`, slug: first.slug })),
    ).toEqual(['slug is already used by another brand'])
  })

  test('checks every field', async () => {
    expect(
      await validationIssues(
        create({ name: ' ', slug: 'Bad Slug', isActive: 'yes' }),
      ),
    ).toEqual([
      'name must not be empty',
      'slug must be lowercase letters and digits joined by single hyphens, like kitchen-and-dining',
      'isActive must be true or false',
    ])
  })

  test('refuses anyone but an administrator', async () => {
    await expect(
      create(
        { name: `Brand ${tag()}` },
        { role: 'seller', userId: randomUUID(), sellerId: randomUUID() },
      ),
    ).rejects.toThrow(ForbiddenError)
  })
})

describe('updateBrand', () => {
  test('changes the name, slug, and active flag, recording only what changed', async () => {
    const t = tag()
    const brand = await create({ name: `Jute Works ${t}` })
    const changed = await update(brand.id, {
      name: `Jute Works India ${t}`,
      isActive: false,
    })
    expect(changed).toMatchObject({
      name: `Jute Works India ${t}`,
      // The slug stays unless an administrator chooses a new one.
      slug: brand.slug,
      isActive: false,
    })
    expect((await auditFor(brand.id)).at(-1)).toEqual({
      action: 'brand.update',
      actorUserId: admin.userId,
      before: { name: `Jute Works ${t}`, isActive: true },
      after: { name: `Jute Works India ${t}`, isActive: false },
    })
    await expect(
      update(brand.id, { slug: `jute-works-india-${t}` }),
    ).resolves.toMatchObject({ slug: `jute-works-india-${t}` })
  })

  test('refuses a name or slug another brand has, but not its own', async () => {
    const t = tag()
    const a = await create({ name: `Alpha ${t}` })
    const b = await create({ name: `Beta ${t}` })
    expect(
      await validationIssues(
        update(b.id, { name: `ALPHA ${t}`, slug: a.slug }),
      ),
    ).toEqual([
      'name is already used by another brand',
      'slug is already used by another brand',
    ])
    await expect(update(a.id, { name: `ALPHA ${t}` })).resolves.toMatchObject({
      name: `ALPHA ${t}`,
    })
  })

  test('refuses an empty change and a brand that does not exist', async () => {
    const brand = await create({ name: `Brand ${tag()}` })
    await expect(update(brand.id, {})).rejects.toThrow(
      'There is nothing to change',
    )
    await expect(update(randomUUID(), { name: 'X' })).rejects.toThrow(
      NotFoundError,
    )
  })
})

describe('listing brands', () => {
  test('pages A to Z, ignoring capital letters', async () => {
    const t = tag()
    // Created out of order, with mixed capitals.
    for (const name of [`gamma ${t}`, `Alpha ${t}`, `beta ${t}`]) {
      await create({ name })
    }
    const first = await publicList({ q: t, limit: 2 })
    expect(first.items.map((brand) => brand.name)).toEqual([
      `Alpha ${t}`,
      `beta ${t}`,
    ])
    expect(first.nextCursor).not.toBeNull()
    const second = await publicList({
      q: t,
      limit: 2,
      cursor: first.nextCursor!,
    })
    expect(second.items.map((brand) => brand.name)).toEqual([`gamma ${t}`])
    expect(second.nextCursor).toBeNull()
  })

  test('visitors see only active brands, without the bookkeeping fields', async () => {
    const t = tag()
    const shown = await create({ name: `Shown ${t}` })
    await create({ name: `Hidden ${t}`, isActive: false })

    expect((await publicList({ q: t })).items).toEqual([
      { id: shown.id, name: shown.name, slug: shown.slug },
    ])
    expect((await adminList({ q: t })).items.map((b) => b.name)).toEqual([
      `Hidden ${t}`,
      `Shown ${t}`,
    ])
  })

  test('treats % and _ in the search as plain characters', async () => {
    const t = tag()
    await create({ name: `100% Cotton ${t}` })
    await create({ name: `1000 Cotton ${t}` })
    expect(
      (await publicList({ q: `100% Cotton ${t}` })).items.map((b) => b.name),
    ).toEqual([`100% Cotton ${t}`])
    expect((await publicList({ q: `_${t}` })).items).toEqual([])
  })

  test('refuses a broken cursor, a cursor from another list, and a long search', async () => {
    await expect(publicList({ cursor: 'nonsense' })).rejects.toThrow(
      'That page cursor is not valid',
    )
    await expect(
      publicList({
        cursor: encodeCursor('2026-10-06T10:00:00.000000Z', randomUUID()),
      }),
    ).rejects.toThrow('That page cursor is not valid')
    await expect(publicList({ q: 'x'.repeat(81) })).rejects.toThrow(
      'q must be at most 80 characters',
    )
  })

  test('only administrators see every brand', async () => {
    await expect(
      withContext(web, { role: 'anonymous' }, (tx) =>
        listAllBrands(tx, { role: 'anonymous' }),
      ),
    ).rejects.toThrow(ForbiddenError)
  })
})

describe('deleteBrand', () => {
  test('deletes an unused brand and records it', async () => {
    const brand = await create({ name: `Brand ${tag()}` })
    await remove(brand.id)
    expect((await adminList({ q: brand.name })).items).toEqual([])
    expect((await auditFor(brand.id)).at(-1)).toMatchObject({
      action: 'brand.delete',
      before: { name: brand.name },
      after: null,
    })
  })

  test('refuses a brand that a product uses', async () => {
    const brand = await create({ name: `Brand ${tag()}` })
    const { seller } = await createTestSeller(owner)
    const category = await createTestCategory(owner)
    await createTestProduct(owner, {
      sellerId: seller.id,
      categoryId: category.id,
      brandId: brand.id,
      status: 'draft',
    })
    await expect(remove(brand.id)).rejects.toThrow(
      new ConflictError(
        'Products use this brand; deactivate it instead of deleting it',
      ),
    )
  })

  test('404 for a brand that does not exist, 403 for anyone else', async () => {
    await expect(remove(randomUUID())).rejects.toThrow(NotFoundError)
    const brand = await create({ name: `Brand ${tag()}` })
    await expect(
      remove(brand.id, { role: 'buyer', userId: randomUUID() }),
    ).rejects.toThrow(ForbiddenError)
  })
})
