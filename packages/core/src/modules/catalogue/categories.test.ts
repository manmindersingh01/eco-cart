import { randomUUID } from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import { auditLogs, categories } from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../errors.ts'
import {
  createTestProduct,
  createTestSeller,
  createTestUser,
} from '../../testing/fixtures.ts'
import { validationIssues } from '../../testing/errors.ts'
import {
  createCategory,
  deleteCategory,
  getCategoryTree,
  getFullCategoryTree,
  loadCategoryTree,
  updateCategory,
} from './categories.ts'
import type { CategoryNode, CategoryView, PublicCategory } from './types.ts'

/*
 * Other test files add categories too, so every test builds its own branch
 * under a top-level category with a unique name.
 */

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'categories-test')
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

const unique = () => randomUUID().slice(0, 8)

const create = (input: unknown, context: RequestContext = admin) =>
  withContext(web, context, (tx) => createCategory(tx, context, input))
const update = (id: string, input: unknown, context: RequestContext = admin) =>
  withContext(web, context, (tx) => updateCategory(tx, context, id, input))
const remove = (id: string, context: RequestContext = admin) =>
  withContext(web, context, (tx) => deleteCategory(tx, context, id))
const tree = () => withContext(web, admin, (tx) => loadCategoryTree(tx))

/** Top > Middle > Bottom, under a unique top-level name. */
async function branch(): Promise<{
  top: CategoryView
  middle: CategoryView
  bottom: CategoryView
}> {
  const top = await create({ name: `Home ${unique()}`, gstRateBps: 1800 })
  const middle = await create({
    name: 'Kitchen',
    parentId: top.id,
    gstRateBps: 1800,
  })
  const bottom = await create({
    name: 'Bottles',
    parentId: middle.id,
    gstRateBps: 500,
    defaultHsnCode: '7323',
  })
  return { top, middle, bottom }
}

const auditFor = (categoryId: string) =>
  owner
    .select({
      action: auditLogs.action,
      actorUserId: auditLogs.actorUserId,
      actorRole: auditLogs.actorRole,
      before: auditLogs.before,
      after: auditLogs.after,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.entityType, 'category'),
        eq(auditLogs.entityId, categoryId),
      ),
    )
    .orderBy(auditLogs.id)

describe('createCategory', () => {
  test('builds three levels, each one deeper than its parent', async () => {
    const name = `Home & Kitchen ${unique()}`
    const top = await create({ name, gstRateBps: 1800 })
    const middle = await create({
      name: 'Kitchen & Dining',
      parentId: top.id,
      gstRateBps: 1800,
      sortOrder: 3,
    })
    const bottom = await create({
      name: 'Bamboo Kitchenware',
      parentId: middle.id,
      gstRateBps: 500,
      defaultHsnCode: '4419',
    })

    expect(top).toMatchObject({
      name,
      slug: `home-and-kitchen-${name.slice(-8)}`,
      parentId: null,
      depth: 0,
      gstRateBps: 1800,
      defaultHsnCode: null,
      sortOrder: 0,
      isActive: true,
    })
    expect(middle).toMatchObject({ parentId: top.id, depth: 1, sortOrder: 3 })
    expect(bottom).toMatchObject({
      parentId: middle.id,
      depth: 2,
      gstRateBps: 500,
      defaultHsnCode: '4419',
    })
    expect(await auditFor(bottom.id)).toEqual([
      {
        action: 'category.create',
        actorUserId: admin.userId,
        actorRole: 'admin',
        before: null,
        after: expect.objectContaining({
          id: bottom.id,
          name: 'Bamboo Kitchenware',
          gstRateBps: 500,
          depth: 2,
        }),
      },
    ])
  })

  test('refuses a fourth level', async () => {
    const { bottom } = await branch()
    expect(
      await validationIssues(
        create({ name: 'Steel', parentId: bottom.id, gstRateBps: 500 }),
      ),
    ).toEqual([
      'parentId is already at the lowest level; categories go at most 3 levels deep',
    ])
  })

  test('refuses a parent that does not exist', async () => {
    expect(
      await validationIssues(
        create({ name: 'Orphan', parentId: randomUUID(), gstRateBps: 500 }),
      ),
    ).toEqual(['parentId is not an existing category'])
    expect(
      await validationIssues(
        create({ name: 'Orphan', parentId: 'kitchen', gstRateBps: 500 }),
      ),
    ).toEqual(['parentId must be a category id'])
  })

  test('refuses a name a sibling already has, ignoring capital letters', async () => {
    const { middle } = await branch()
    expect(
      await validationIssues(
        create({ name: 'BOTTLES', parentId: middle.id, gstRateBps: 500 }),
      ),
    ).toEqual(['name is already used by another category in Kitchen'])

    const name = `Garden ${unique()}`
    await create({ name, gstRateBps: 1800 })
    expect(
      await validationIssues(
        create({ name: name.toUpperCase(), gstRateBps: 1800 }),
      ),
    ).toEqual(['name is already used by another category at the top level'])
  })

  test('allows one name in two places, numbering the second slug', async () => {
    const name = `Accessories ${unique()}`
    const first = await branch()
    const second = await branch()
    const a = await create({ name, parentId: first.top.id, gstRateBps: 1800 })
    const b = await create({ name, parentId: second.top.id, gstRateBps: 1800 })
    const base = `accessories-${name.slice(-8)}`
    expect([a.slug, b.slug]).toEqual([base, `${base}-2`])
  })

  test('takes a chosen slug, and refuses one that is taken', async () => {
    const slug = `eco-home-${unique()}`
    const chosen = await create({
      name: `Home ${unique()}`,
      gstRateBps: 1800,
      slug,
    })
    expect(chosen.slug).toBe(slug)
    expect(
      await validationIssues(
        create({ name: `Home ${unique()}`, gstRateBps: 1800, slug }),
      ),
    ).toEqual(['slug is already used by another category'])
    expect(
      await validationIssues(
        create({
          name: `Home ${unique()}`,
          gstRateBps: 1800,
          slug: 'Eco Home',
        }),
      ),
    ).toEqual([
      'slug must be lowercase letters and digits joined by single hyphens, like kitchen-and-dining',
    ])
  })

  test('accepts only current GST rates and real HSN code lengths', async () => {
    expect(
      await validationIssues(
        create({
          name: `Clothing ${unique()}`,
          gstRateBps: 1200,
          defaultHsnCode: '61091',
          colour: 'green',
        }),
      ),
    ).toEqual([
      'gstRateBps must be one of the current GST rates in basis points: 0 (0%), 25 (0.25%), 300 (3%), 500 (5%), 1800 (18%), 4000 (40%)',
      'defaultHsnCode must be an HSN code of 4, 6, or 8 digits, like 4419',
      'colour is not allowed here',
    ])
    for (const [gstRateBps, defaultHsnCode] of [
      [0, '4419'],
      [25, '710210'],
      [4000, '87112019'],
    ] as const) {
      await expect(
        create({ name: `Rate ${unique()}`, gstRateBps, defaultHsnCode }),
      ).resolves.toMatchObject({ gstRateBps, defaultHsnCode })
    }
  })

  test.each<[string, RequestContext]>([
    ['a visitor', { role: 'anonymous' }],
    ['a buyer', { role: 'buyer', userId: randomUUID() }],
    [
      'a seller',
      { role: 'seller', userId: randomUUID(), sellerId: randomUUID() },
    ],
  ])('refuses %s', async (_who, context) => {
    await expect(
      create({ name: `Home ${unique()}`, gstRateBps: 1800 }, context),
    ).rejects.toThrow(ForbiddenError)
  })
})

describe('updateCategory', () => {
  test('changes details and records only what changed', async () => {
    const { bottom } = await branch()
    const changed = await update(bottom.id, {
      name: 'Steel Bottles',
      gstRateBps: 1800,
      isActive: false,
    })
    expect(changed).toMatchObject({
      name: 'Steel Bottles',
      slug: bottom.slug,
      gstRateBps: 1800,
      isActive: false,
      depth: 2,
    })
    expect((await auditFor(bottom.id)).at(-1)).toEqual({
      action: 'category.update',
      actorUserId: admin.userId,
      actorRole: 'admin',
      before: { name: 'Bottles', gstRateBps: 500, isActive: true },
      after: { name: 'Steel Bottles', gstRateBps: 1800, isActive: false },
    })
  })

  test('moves a category with everything below it', async () => {
    const { top, middle, bottom } = await branch()
    const other = await create({ name: `Garden ${unique()}`, gstRateBps: 1800 })

    await update(middle.id, { parentId: other.id })
    let current = await tree()
    expect(current.pathTo(bottom.id).map((c) => c.id)).toEqual([
      other.id,
      middle.id,
      bottom.id,
    ])
    expect(current.childrenOf(top.id)).toEqual([])

    // To the top level: everything below rises by one.
    await update(middle.id, { parentId: null })
    current = await tree()
    expect(current.byId(middle.id)?.depth).toBe(0)
    expect(current.byId(bottom.id)?.depth).toBe(1)
    expect((await auditFor(middle.id)).at(-1)).toMatchObject({
      before: { parentId: other.id, depth: 1 },
      after: { parentId: null, depth: 0 },
    })
  })

  test('refuses a move that would make the tree too deep', async () => {
    const { middle } = await branch()
    const target = await branch()
    expect(
      await validationIssues(update(middle.id, { parentId: target.middle.id })),
    ).toEqual([
      'parentId is too deep for this category and its subcategories; categories go at most 3 levels deep',
    ])
  })

  test('refuses to move a category inside itself or below its subcategories', async () => {
    const { top, bottom } = await branch()
    for (const parentId of [top.id, bottom.id]) {
      expect(await validationIssues(update(top.id, { parentId }))).toEqual([
        'parentId cannot be the category itself or one of its subcategories',
      ])
    }
  })

  test('two moves at the same moment never create a loop', async () => {
    const x = await create({ name: `X ${unique()}`, gstRateBps: 1800 })
    const y = await create({ name: `Y ${unique()}`, gstRateBps: 1800 })

    // A third transaction holds both rows, so neither move can save before
    // both have started. Each move alone is allowed; only the table lock
    // makes the second one see the first and refuse.
    const { pid, release, finished } = await holdRows([x.id, y.id])
    const moves = Promise.allSettled([
      update(x.id, { parentId: y.id }),
      update(y.id, { parentId: x.id }),
    ])
    await waitUntil(async () => (await sessionsWaitingOn(pid)) >= 2)
    release()
    await finished
    const results = await moves

    expect(
      results
        .map((result) => result.status)
        .toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(['fulfilled', 'rejected'])
    const refused = results.find((result) => result.status === 'rejected')
    expect(refused?.reason).toBeInstanceOf(ValidationError)
    const current = await tree()
    // Whichever won, one of them is now at the top with the other inside.
    const levels = [x, y].map((c) => current.pathTo(c.id).length)
    expect(levels.toSorted((a, b) => a - b)).toEqual([1, 2])
  })

  test('refuses a move next to a sibling with the same name', async () => {
    const a = await branch()
    const b = await branch()
    expect(
      await validationIssues(update(a.bottom.id, { parentId: b.middle.id })),
    ).toEqual(['name is already used by another category in Kitchen'])
  })

  test('refuses a taken slug, an empty change, and a missing category', async () => {
    const { middle, bottom } = await branch()
    expect(
      await validationIssues(update(bottom.id, { slug: middle.slug })),
    ).toEqual(['slug is already used by another category'])
    await expect(update(bottom.id, {})).rejects.toThrow(
      'There is nothing to change',
    )
    await expect(update(randomUUID(), { name: 'X' })).rejects.toThrow(
      NotFoundError,
    )
    await expect(update('bottles', { name: 'X' })).rejects.toThrow(
      NotFoundError,
    )
  })

  test('refuses anyone but an administrator', async () => {
    const { bottom } = await branch()
    await expect(
      update(bottom.id, { name: 'X' }, { role: 'buyer', userId: randomUUID() }),
    ).rejects.toThrow(ForbiddenError)
  })
})

/**
 * Locks category rows in a transaction of their own until `release` is
 * called. `pid` is that transaction's database session.
 */
async function holdRows(ids: string[]) {
  const released = Promise.withResolvers<void>()
  const held = Promise.withResolvers<number>()
  const finished = owner.transaction(async (tx) => {
    const result = await tx.execute<{ pid: number }>(
      sql`select pg_backend_pid() as pid`,
    )
    await tx
      .select({ id: categories.id })
      .from(categories)
      .where(inArray(categories.id, ids))
      .for('update')
    held.resolve(result.rows[0]!.pid)
    await released.promise
  })
  return { pid: await held.promise, release: released.resolve, finished }
}

/** Sessions waiting on `pid`, directly or behind another waiting session. */
async function sessionsWaitingOn(pid: number): Promise<number> {
  const result = await owner.execute<{ count: number }>(sql`
    select count(*)::int as count
    from pg_stat_activity a
    where ${pid} = any(pg_blocking_pids(a.pid))
       or exists (
         select 1 from pg_stat_activity b
         where b.pid = any(pg_blocking_pids(a.pid))
           and ${pid} = any(pg_blocking_pids(b.pid))
       )
  `)
  return result.rows[0]!.count
}

async function waitUntil(condition: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5000
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const findNode = <N extends { id: string; children: N[] }>(
  nodes: N[],
  id: string,
): N | undefined =>
  nodes.find((node) => node.id === id) ??
  nodes
    .map((node) => findNode(node.children, id))
    .find((node) => node !== undefined)

describe('reading the tree', () => {
  test('the public tree leaves out an inactive category and everything below it', async () => {
    const { top, middle, bottom } = await branch()
    const storage = await create({
      name: 'Storage',
      parentId: top.id,
      gstRateBps: 1800,
    })
    await update(middle.id, { isActive: false })

    const visible = await withContext(web, { role: 'anonymous' }, (tx) =>
      getCategoryTree(tx),
    )
    expect(findNode(visible, top.id)).toEqual<PublicCategory>({
      id: top.id,
      name: top.name,
      slug: top.slug,
      gstRateBps: 1800,
      defaultHsnCode: null,
      children: [
        {
          id: storage.id,
          name: 'Storage',
          slug: storage.slug,
          gstRateBps: 1800,
          defaultHsnCode: null,
          children: [],
        },
      ],
    })
    expect(findNode(visible, bottom.id)).toBeUndefined()

    const full = await withContext(web, admin, (tx) =>
      getFullCategoryTree(tx, admin),
    )
    expect(findNode<CategoryNode>(full, middle.id)).toMatchObject({
      isActive: false,
      children: [expect.objectContaining({ id: bottom.id, isActive: true })],
    })
  })

  test('only administrators see the full tree', async () => {
    await expect(
      withContext(web, { role: 'anonymous' }, (tx) =>
        getFullCategoryTree(tx, { role: 'anonymous' }),
      ),
    ).rejects.toThrow(ForbiddenError)
  })
})

describe('deleteCategory', () => {
  test('deletes an unused category and records it', async () => {
    const { bottom } = await branch()
    await remove(bottom.id)
    expect((await tree()).byId(bottom.id)).toBeUndefined()
    expect((await auditFor(bottom.id)).at(-1)).toMatchObject({
      action: 'category.delete',
      before: expect.objectContaining({ name: 'Bottles', depth: 2 }),
      after: null,
    })
  })

  test('refuses a category with subcategories or products', async () => {
    const { middle, bottom } = await branch()
    await expect(remove(middle.id)).rejects.toThrow(
      new ConflictError(
        'This category has subcategories; move or delete them first, or deactivate it',
      ),
    )
    const { seller } = await createTestSeller(owner)
    // Even a draft product keeps its category.
    await createTestProduct(owner, {
      sellerId: seller.id,
      categoryId: bottom.id,
      status: 'draft',
    })
    await expect(remove(bottom.id)).rejects.toThrow(
      new ConflictError(
        'Products are listed in this category; deactivate it instead of deleting it',
      ),
    )
  })

  test('404 for a category that does not exist, 403 for anyone else', async () => {
    await expect(remove(randomUUID())).rejects.toThrow(NotFoundError)
    const { bottom } = await branch()
    await expect(
      remove(bottom.id, { role: 'buyer', userId: randomUUID() }),
    ).rejects.toThrow(ForbiddenError)
  })
})

/** Inserts a category directly as the owner, past every service check. */
const insertRaw = (values: Partial<typeof categories.$inferInsert>) =>
  owner.insert(categories).values({
    name: `Raw ${unique()}`,
    slug: `raw-${unique()}`,
    gstRateBps: 500,
    ...values,
  })

/** The database constraint that refused `attempt`. */
async function refusingConstraint(attempt: Promise<unknown>): Promise<string> {
  const error = await attempt.then(
    () => null,
    (caught: unknown) => caught,
  )
  const cause = error instanceof Error ? error.cause : null
  if (
    typeof cause !== 'object' ||
    cause === null ||
    !('constraint' in cause) ||
    typeof cause.constraint !== 'string'
  ) {
    throw new Error(`Expected a constraint error, got ${String(error)}`)
  }
  return cause.constraint
}

describe('database rules', () => {
  test('refuse what the service would refuse, even past the service', async () => {
    const { bottom } = await branch()
    expect(
      await refusingConstraint(insertRaw({ parentId: bottom.id, depth: 3 })),
    ).toBe('categories_depth_check')
    expect(
      await refusingConstraint(insertRaw({ parentId: null, depth: 1 })),
    ).toBe('categories_depth_parent_check')
    expect(
      await refusingConstraint(insertRaw({ parentId: bottom.id, depth: 0 })),
    ).toBe('categories_depth_parent_check')
    expect(
      await refusingConstraint(insertRaw({ defaultHsnCode: '12345' })),
    ).toBe('categories_default_hsn_code_check')
    expect(await refusingConstraint(insertRaw({ slug: 'Not A Slug' }))).toBe(
      'categories_slug_check',
    )
    expect(
      await refusingConstraint(
        insertRaw({ parentId: bottom.parentId, depth: 2, name: 'BOTTLES' }),
      ),
    ).toBe('categories_parent_id_name_unique')
  })
})
