import { eq, gt, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import {
  auditLogs,
  cacheInvalidations,
  contentPages,
} from '../../db/schema/index.ts'
import { seedContentPages } from '../../db/seed.ts'
import { requireEnv } from '../../env.ts'
import { ForbiddenError, NotFoundError, ValidationError } from '../../errors.ts'
import { createTestUser } from '../../testing/fixtures.ts'
import {
  getContentPage,
  getPublishedContentPage,
  listContentPages,
  saveContentPage,
} from './service.ts'

/*
 * Content pages (backend spec step 16). The set of pages is fixed, so this
 * file owns content_pages: it is the only test file that writes the table,
 * and it empties it before each test.
 */

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'content-test')
  pools.push(pool)
  return createDatabase(pool)
}
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))
const web = connect(requireEnv('DATABASE_URL'))

let admin: Extract<RequestContext, { role: 'admin' }>

beforeAll(async () => {
  admin = { role: 'admin', userId: (await createTestUser(owner, 'admin')).id }
})

beforeEach(async () => {
  await owner.delete(contentPages)
})

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()))
})

const save = (slug: string, input: unknown, ip?: string) =>
  withContext(web, admin, (tx) => saveContentPage(tx, admin, slug, input, ip))

const read = (slug: string) =>
  withContext(web, { role: 'anonymous' }, (tx) =>
    getPublishedContentPage(tx, slug),
  )

const returns = (
  status: 'draft' | 'published',
  body = 'Return within 7 days.',
) => ({
  title: 'Returns policy',
  bodyMarkdown: body,
  status,
})

async function tagsDuring(change: () => Promise<unknown>): Promise<string[]> {
  const [mark] = await owner
    .select({ id: sql<number>`coalesce(max(id), 0)::int` })
    .from(cacheInvalidations)
  await change()
  const rows = await owner
    .select({ tag: cacheInvalidations.tag })
    .from(cacheInvalidations)
    .where(gt(cacheInvalidations.id, mark!.id))
  return rows.map((row) => row.tag)
}

describe('content pages', () => {
  test('administrators see every page, also those nobody has written', async () => {
    const pages = await withContext(web, admin, (tx) =>
      listContentPages(tx, admin),
    )
    expect(pages.map((page) => [page.slug, page.title, page.saved])).toEqual([
      ['terms', 'Terms of use', false],
      ['privacy', 'Privacy policy', false],
      ['shipping', 'Shipping policy', false],
      ['returns', 'Returns policy', false],
      ['refunds', 'Refund policy', false],
      ['seller-agreement', 'Seller agreement', false],
    ])
    expect(pages[0]).toMatchObject({ status: 'draft', bodyMarkdown: '' })
  })

  test('a draft stays private until it is published', async () => {
    const tags = await tagsDuring(() => save('returns', returns('draft')))
    expect(tags).not.toContain('content:returns')
    await expect(read('returns')).rejects.toThrow(
      new NotFoundError('There is no page at that address'),
    )

    const published = await save('returns', returns('published'))
    expect(published).toMatchObject({ status: 'published', saved: true })
    expect(published.publishedAt).toBeInstanceOf(Date)
    expect(await read('returns')).toMatchObject({
      slug: 'returns',
      title: 'Returns policy',
      bodyMarkdown: 'Return within 7 days.',
      publishedAt: published.publishedAt,
    })
  })

  test('editing a published page refreshes it and keeps when it was published', async () => {
    const first = await save('returns', returns('published'))
    let edited: Awaited<ReturnType<typeof save>> | undefined
    const tags = await tagsDuring(async () => {
      edited = await save(
        'returns',
        returns('published', 'Return within 10 days.'),
      )
    })
    expect(tags).toContain('content:returns')
    expect(edited!.publishedAt).toEqual(first.publishedAt)
    expect((await read('returns')).bodyMarkdown).toBe('Return within 10 days.')

    // Taking it back to draft hides it, and refreshes it too.
    const hiding = await tagsDuring(() => save('returns', returns('draft')))
    expect(hiding).toContain('content:returns')
    await expect(read('returns')).rejects.toThrow(NotFoundError)
  })

  test('every save writes an audit entry with the text before and after', async () => {
    await save('privacy', {
      title: 'Privacy policy',
      bodyMarkdown: 'We keep your address.',
      status: 'draft',
    })
    await save(
      'privacy',
      {
        title: 'Privacy policy',
        bodyMarkdown: 'We keep your address for deliveries.',
        status: 'published',
      },
      '203.0.113.4',
    )
    const entries = await owner
      .select({
        action: auditLogs.action,
        actor: auditLogs.actorUserId,
        before: auditLogs.before,
        after: auditLogs.after,
        ip: auditLogs.ip,
      })
      .from(auditLogs)
      .where(eq(auditLogs.entityType, 'content_page'))
      .orderBy(auditLogs.id)
    expect(entries.slice(-2)).toEqual([
      {
        action: 'content.save',
        actor: admin.userId,
        before: null,
        after: {
          title: 'Privacy policy',
          status: 'draft',
          bodyMarkdown: 'We keep your address.',
        },
        ip: null,
      },
      {
        action: 'content.save',
        actor: admin.userId,
        before: {
          title: 'Privacy policy',
          status: 'draft',
          bodyMarkdown: 'We keep your address.',
        },
        after: {
          title: 'Privacy policy',
          status: 'published',
          bodyMarkdown: 'We keep your address for deliveries.',
        },
        ip: '203.0.113.4',
      },
    ])
  })

  test('only the six pages exist, only administrators edit them, and bad details are refused', async () => {
    await expect(save('about-us', returns('draft'))).rejects.toThrow(
      new NotFoundError('There is no page at that address'),
    )
    await expect(read('about-us')).rejects.toThrow(NotFoundError)
    const buyer: RequestContext = {
      role: 'buyer',
      userId: (await createTestUser(owner)).id,
    }
    await expect(
      withContext(web, buyer, (tx) =>
        saveContentPage(tx, buyer, 'returns', returns('draft')),
      ),
    ).rejects.toThrow(ForbiddenError)
    await expect(
      withContext(web, buyer, (tx) => getContentPage(tx, buyer, 'returns')),
    ).rejects.toThrow(ForbiddenError)

    const refused = await save('returns', {
      title: ' ',
      bodyMarkdown: 'x'.repeat(50_001),
      status: 'live',
    }).catch((error: unknown) => error)
    if (!(refused instanceof ValidationError)) throw refused
    expect(refused.issues).toEqual([
      'title must not be empty',
      'bodyMarkdown must be at most 50000 characters',
      'status must be draft or published',
    ])
  })
})

describe('seedContentPages', () => {
  test('publishes placeholder text for unsaved pages only, and never in production', async () => {
    await save('returns', returns('draft', 'Our own text.'))
    const written = await seedContentPages(web, { NODE_ENV: 'development' })
    expect(written).toEqual([
      'terms',
      'privacy',
      'shipping',
      'refunds',
      'seller-agreement',
    ])
    expect((await read('terms')).bodyMarkdown).toContain('placeholder text')
    const own = await withContext(web, admin, (tx) =>
      getContentPage(tx, admin, 'returns'),
    )
    expect(own).toMatchObject({
      status: 'draft',
      bodyMarkdown: 'Our own text.',
    })
    expect(await seedContentPages(web, { NODE_ENV: 'development' })).toEqual([])
    await expect(
      seedContentPages(web, { NODE_ENV: 'production' }),
    ).rejects.toThrow('The development seed never runs in production')
  })
})
