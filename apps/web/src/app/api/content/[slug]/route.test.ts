import { createDatabase, createPool, requireEnv, schema } from '@ecokart/core'
import { createTestUser } from '@ecokart/core/testing'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { closePool } from '@/lib/db'
import { closeJobQueue } from '@/lib/queue'
import { apiRequest as request } from '@/testing/requests'
import { signInWithEmail } from '@/testing/sign-in'
import {
  GET as adminPage,
  PUT as savePage,
} from '../../admin/content/[slug]/route'
import { GET as adminPages } from '../../admin/content/route'
import { GET as company } from '../../company/route'
import { GET as page } from './route'

/*
 * The content page routes and the storefront footer (backend spec step 16).
 * This file is the only web test that writes content pages or the company
 * details.
 */

const ownerPool = createPool(
  requireEnv('MIGRATION_DATABASE_URL'),
  'content-route-test',
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

const withSlug = (slug: string) => ({ params: Promise.resolve({ slug }) })
const pageShape = z
  .object({ slug: z.string(), title: z.string(), bodyMarkdown: z.string() })
  .loose()

const put = (slug: string, body: unknown, cookie?: string) =>
  savePage(
    request(`/admin/content/${slug}`, {
      method: 'PUT',
      body,
      ...(cookie ? { cookie } : {}),
    }),
    withSlug(slug),
  )

describe('content pages', () => {
  test('a page is public once an administrator publishes it', async () => {
    const before = await page(
      request('/content/shipping'),
      withSlug('shipping'),
    )
    expect(before.status).toBe(404)

    const saved = await put(
      'shipping',
      {
        title: 'Shipping policy',
        bodyMarkdown: 'We ship within 2 days.',
        status: 'published',
      },
      adminCookie,
    )
    expect(saved.status).toBe(200)
    expect(
      z
        .object({ page: pageShape.extend({ status: z.string() }) })
        .parse(await saved.json()).page,
    ).toMatchObject({ slug: 'shipping', status: 'published' })

    const after = await page(request('/content/shipping'), withSlug('shipping'))
    expect(after.status).toBe(200)
    expect(
      z.object({ page: pageShape }).parse(await after.json()).page,
    ).toMatchObject({
      title: 'Shipping policy',
      bodyMarkdown: 'We ship within 2 days.',
    })

    const unknown = await page(request('/content/about'), withSlug('about'))
    expect(unknown.status).toBe(404)
  })

  test('only administrators list and edit pages', async () => {
    const listed = await adminPages(
      request('/admin/content', { cookie: adminCookie }),
    )
    expect(listed.status).toBe(200)
    const { pages } = z
      .object({ pages: z.array(pageShape) })
      .parse(await listed.json())
    expect(pages.map((item) => item.slug)).toEqual([
      'terms',
      'privacy',
      'shipping',
      'returns',
      'refunds',
      'seller-agreement',
    ])
    const one = await adminPage(
      request('/admin/content/terms', { cookie: adminCookie }),
      withSlug('terms'),
    )
    expect(one.status).toBe(200)

    expect((await adminPages(request('/admin/content'))).status).toBe(401)
    expect(
      (await adminPages(request('/admin/content', { cookie: buyerCookie })))
        .status,
    ).toBe(403)
    const refused = await put(
      'terms',
      { title: 'Terms', bodyMarkdown: '', status: 'draft' },
      buyerCookie,
    )
    expect(refused.status).toBe(403)
    const invalid = await put(
      'terms',
      { title: 'Terms', status: 'live' },
      adminCookie,
    )
    expect(invalid.status).toBe(400)
  })
})

describe('GET /api/company', () => {
  test('503 until the company details are saved, then everything but the PAN', async () => {
    const missing = await company()
    expect(missing.status).toBe(503)

    await owner.insert(schema.platformSettings).values({
      key: 'company_details',
      value: {
        legalName: 'Green Basket Private Limited',
        displayName: 'EcoKart',
        gstin: '29AABCG1234K1Z9',
        pan: 'AABCG1234K',
        address: {
          line1: '21 Residency Road',
          line2: null,
          city: 'Bengaluru',
          stateCode: '29',
          pincode: '560025',
        },
        supportEmail: 'help@ecokart.test',
        supportPhone: '+918012345678',
        grievanceOfficer: {
          name: 'Priya Nair',
          email: 'grievance@ecokart.test',
          phone: '+918012345679',
        },
      },
    })
    const saved = await company()
    expect(saved.status).toBe(200)
    const body = z
      .object({ company: z.record(z.string(), z.unknown()) })
      .parse(await saved.json())
    expect(body.company).not.toHaveProperty('pan')
    expect(body.company).toMatchObject({
      legalName: 'Green Basket Private Limited',
      address: { stateName: 'Karnataka' },
      grievanceOfficer: { name: 'Priya Nair' },
    })
  })
})
