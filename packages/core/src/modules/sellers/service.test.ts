import { randomBytes } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import { auditLogs, products, sellers } from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../errors.ts'
import { encodeCursor } from '../../lib/pagination.ts'
import { startJobQueue, type JobQueue } from '../../lib/queue.ts'
import { lastEmailedCode } from '../../testing/codes.ts'
import {
  createTestCategory,
  createTestProduct,
  createTestUser,
} from '../../testing/fixtures.ts'
import {
  createAccountDirectory,
  type AccountDirectory,
} from '../auth/accounts.ts'
import type { Auth } from '../auth/auth.ts'
import {
  createAppAuth,
  resolveRequestContext,
  SellerSuspendedError,
} from '../auth/service.ts'
import {
  approveSeller,
  createSeller,
  getOwnSeller,
  getSeller,
  listSellers,
  reinstateSeller,
  suspendSeller,
  updateOwnContacts,
  updateSeller,
  type SellerServices,
} from './service.ts'

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'sellers-test')
  pools.push(pool)
  return createDatabase(pool)
}
const web = connect(requireEnv('DATABASE_URL'))
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))

const baseURL = 'http://localhost:3000'
const encryptionKey = randomBytes(32)
let queue: JobQueue
let auth: Auth
let accounts: AccountDirectory
let services: SellerServices
let admin: Extract<RequestContext, { role: 'admin' }>

beforeAll(async () => {
  queue = await startJobQueue(requireEnv('DATABASE_URL'), 'sellers-test')
  auth = createAppAuth({
    db: web,
    getQueue: async () => queue,
    config: {
      baseURL,
      secret: 'test-secret-for-sessions-0123456789abcdef',
      encryptionKey,
      smsOtpEnabled: false,
    },
  })
  accounts = createAccountDirectory(auth)
  services = { db: web, accounts }
  const adminUser = await createTestUser(owner, 'admin')
  admin = { role: 'admin', userId: adminUser.id }
})

afterAll(async () => {
  await queue.stop()
  await Promise.all(pools.map((pool) => pool.end()))
})

const randomLetters = (length: number) =>
  Array.from(
    randomBytes(length),
    (byte) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[byte % 26],
  ).join('')

/** Valid details for a new seller, unique on every call. */
function sellerInput(overrides: Record<string, unknown> = {}) {
  return {
    owner: {
      email: `${crypto.randomUUID()}@example.test`,
      name: 'Ravi Kumar',
      phoneNumber: null,
    },
    displayName: `Green Basket ${randomLetters(5)}`,
    legalName: 'Green Basket Organics Private Limited',
    gstin: '27AABCG1234K1Z9',
    pan: 'AABCG1234K',
    line1: '12 MG Road',
    city: 'Pune',
    stateCode: '27',
    pincode: '411001',
    supportEmail: 'help@greenbasket.test',
    supportPhone: '+912012340001',
    invoicePrefix: randomLetters(6),
    commissionBps: null,
    ...overrides,
  }
}

/** The reasons a call was refused; fails the test if it was not. */
async function validationIssues(attempt: Promise<unknown>): Promise<string[]> {
  const error = await attempt.then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof ValidationError)) {
    throw new Error(`Expected a ValidationError, got ${String(error)}`)
  }
  return error.issues
}

const auditFor = (sellerId: string) =>
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
      and(eq(auditLogs.entityType, 'seller'), eq(auditLogs.entityId, sellerId)),
    )
    .orderBy(auditLogs.id)

const authPost = (path: string, body: object) =>
  auth.handler(
    new Request(`${baseURL}/api/auth${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: baseURL,
        'x-forwarded-for': `198.18.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
      },
      body: JSON.stringify(body),
    }),
  )

/** Signs the owner in with an email code and returns the session cookie. */
async function signIn(email: string): Promise<string> {
  await authPost('/email-otp/send-verification-otp', {
    email,
    type: 'sign-in',
  })
  const otp = await lastEmailedCode(owner, email, encryptionKey)
  const response = await authPost('/sign-in/email-otp', { email, otp })
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith('ecokart.session_token='))
    ?.split(';')[0]
  if (!cookie) throw new Error(`Sign-in failed with ${response.status}`)
  return cookie
}

const sessionFor = (cookie: string) =>
  auth.api.getSession({ headers: new Headers({ cookie }) })

describe('createSeller', () => {
  test('creates a pending business and a seller account for its owner', async () => {
    const input = sellerInput({ displayName: 'Green Basket & Co.' })
    const seller = await createSeller(services, admin, input)

    expect(seller).toMatchObject({
      status: 'pending',
      displayName: 'Green Basket & Co.',
      approvedAt: null,
    })
    expect(seller.slug).toMatch(/^green-basket-and-co(-\d+)?$/)
    expect(await accounts.findById(seller.ownerUserId)).toMatchObject({
      email: input.owner.email,
      role: 'seller',
      banned: false,
    })
    expect(await auditFor(seller.id)).toEqual([
      expect.objectContaining({
        action: 'seller.create',
        actorUserId: admin.userId,
        actorRole: 'admin',
        after: expect.objectContaining({ ownerEmail: input.owner.email }),
      }),
    ])
  })

  test.each<[string, RequestContext]>([
    ['a buyer', { role: 'buyer', userId: crypto.randomUUID() }],
    [
      'a seller',
      {
        role: 'seller',
        userId: crypto.randomUUID(),
        sellerId: crypto.randomUUID(),
      },
    ],
    ['a visitor', { role: 'anonymous' }],
  ])('refuses %s, and creates no account', async (_who, context) => {
    const input = sellerInput()
    await expect(createSeller(services, context, input)).rejects.toThrow(
      ForbiddenError,
    )
    expect(await accounts.findByEmail(input.owner.email)).toBeNull()
  })

  test.each<[string, Record<string, unknown>, string]>([
    ['a malformed GSTIN', { gstin: '27AABCG1234K1Z' }, 'gstin must be a GSTIN'],
    [
      'a PAN that is not inside the GSTIN',
      { pan: 'AABCG9999K' },
      'gstin must contain the PAN as its 3rd to 12th characters',
    ],
    [
      'a GSTIN from another state',
      { stateCode: '29' },
      'gstin must start with the state code of the address (29)',
    ],
    [
      'a five-digit PIN code',
      { pincode: '41100' },
      'pincode must be a six-digit PIN code',
    ],
    [
      'a phone without +91',
      { supportPhone: '02012340001' },
      'supportPhone must be in international format',
    ],
    [
      'a lower-case invoice prefix',
      { invoicePrefix: 'grb' },
      'invoicePrefix must be 1 to 6 capital letters or digits',
    ],
    [
      'a seven-letter invoice prefix',
      { invoicePrefix: 'ABCDEFG' },
      'invoicePrefix must be 1 to 6 capital letters or digits',
    ],
    [
      'a commission over 100%',
      { commissionBps: 10_001 },
      'commissionBps must be at most 10000',
    ],
    [
      'a field that does not exist',
      { website: 'https://x.test' },
      'website is not allowed here',
    ],
  ])('refuses %s', async (_case, overrides, issue) => {
    const issues = await validationIssues(
      createSeller(services, admin, sellerInput(overrides)),
    )
    expect(issues.join('\n')).toContain(issue)
  })

  test('refuses an owner phone that is not an Indian mobile', async () => {
    const input = sellerInput()
    const issues = await validationIssues(
      createSeller(services, admin, {
        ...input,
        owner: { ...input.owner, phoneNumber: '+14155550100' },
      }),
    )
    expect(issues).toEqual([
      'owner.phoneNumber must be an Indian mobile number, like +919812345678',
    ])
  })

  test('refuses an email that already has an account', async () => {
    const buyer = await createTestUser(owner, 'buyer')
    const input = sellerInput()
    const issues = await validationIssues(
      createSeller(services, admin, {
        ...input,
        owner: { ...input.owner, email: buyer.email.toUpperCase() },
      }),
    )
    expect(issues).toEqual([
      'owner.email already has an account; a seller needs an email address of its own',
    ])
  })

  test('refuses an invoice prefix another seller uses, before creating an account', async () => {
    const first = await createSeller(services, admin, sellerInput())
    const second = sellerInput({ invoicePrefix: first.invoicePrefix })
    expect(
      await validationIssues(createSeller(services, admin, second)),
    ).toEqual(['invoicePrefix is already used by another seller'])
    expect(await accounts.findByEmail(second.owner.email)).toBeNull()
  })

  test('removes the new account when the business cannot be saved', async () => {
    // Another administrator takes the same invoice prefix in the moment
    // between our check and our save.
    const input = sellerInput()
    const racing: AccountDirectory = {
      ...accounts,
      async createSellerOwner(ownerDetails) {
        const account = await accounts.createSellerOwner(ownerDetails)
        await createSeller(services, admin, {
          ...sellerInput(),
          invoicePrefix: input.invoicePrefix,
        })
        return account
      },
    }
    expect(
      await validationIssues(
        createSeller({ db: web, accounts: racing }, admin, input),
      ),
    ).toEqual(['invoicePrefix is already used by another seller'])
    expect(await accounts.findByEmail(input.owner.email)).toBeNull()
  })

  test('numbers slugs when the display name is taken', async () => {
    const displayName = `Bamboo Home ${randomLetters(6)}`
    const slugs = []
    for (let i = 0; i < 3; i++) {
      slugs.push(
        (await createSeller(services, admin, sellerInput({ displayName })))
          .slug,
      )
    }
    const base = displayName.toLowerCase().replaceAll(' ', '-')
    expect(slugs).toEqual([base, `${base}-2`, `${base}-3`])
  })
})

describe('approveSeller', () => {
  test('approves a pending seller and audits it', async () => {
    const seller = await createSeller(services, admin, sellerInput())
    const approved = await approveSeller(web, admin, seller.id)
    expect(approved.status).toBe('approved')
    expect(approved.approvedAt).toBeInstanceOf(Date)
    expect((await auditFor(seller.id)).at(-1)).toMatchObject({
      action: 'seller.approve',
      before: { status: 'pending' },
      after: { status: 'approved' },
    })
    // A second approval changes nothing.
    expect((await approveSeller(web, admin, seller.id)).approvedAt).toEqual(
      approved.approvedAt,
    )
  })

  test('needs a GSTIN and a PAN', async () => {
    const seller = await createSeller(
      services,
      admin,
      sellerInput({ gstin: null, pan: null }),
    )
    expect(
      await validationIssues(approveSeller(web, admin, seller.id)),
    ).toEqual([
      'gstin is needed before approval',
      'pan is needed before approval',
    ])
  })

  test('404 for an unknown or malformed id', async () => {
    await expect(
      approveSeller(web, admin, crypto.randomUUID()),
    ).rejects.toThrow(NotFoundError)
    await expect(approveSeller(web, admin, 'not-an-id')).rejects.toThrow(
      NotFoundError,
    )
  })
})

describe('suspension', () => {
  test('ends the owner’s sessions, blocks sign-in, and refuses the seller', async () => {
    const input = sellerInput()
    const seller = await createSeller(services, admin, input)
    await approveSeller(web, admin, seller.id)
    const cookie = await signIn(input.owner.email)
    const sellerUser = (await sessionFor(cookie))!.user

    const suspended = await suspendSeller(services, admin, seller.id, {
      reason: 'Fake listings',
    })

    expect(suspended).toMatchObject({
      status: 'suspended',
      suspendedReason: 'Fake listings',
    })
    expect(await sessionFor(cookie)).toBeNull()
    expect(await accounts.findById(seller.ownerUserId)).toMatchObject({
      banned: true,
      banReason: 'Seller suspended: Fake listings',
    })
    // Even with a session that somehow survived, the seller cannot act.
    await expect(resolveRequestContext(web, sellerUser)).rejects.toThrow(
      SellerSuspendedError,
    )
    await expect(approveSeller(web, admin, seller.id)).rejects.toThrow(
      ConflictError,
    )
    expect((await auditFor(seller.id)).at(-1)).toMatchObject({
      action: 'seller.suspend',
      before: { status: 'approved' },
      after: { status: 'suspended', reason: 'Fake listings' },
    })
  })

  test('needs a reason', async () => {
    const seller = await createSeller(services, admin, sellerInput())
    expect(
      await validationIssues(suspendSeller(services, admin, seller.id, {})),
    ).toEqual(['reason must be text'])
  })

  test('reinstating lifts the ban and returns the seller to where it was', async () => {
    const input = sellerInput()
    const approved = await createSeller(services, admin, input)
    await approveSeller(web, admin, approved.id)
    await suspendSeller(services, admin, approved.id, { reason: 'Checking' })
    const back = await reinstateSeller(services, admin, approved.id)
    expect(back).toMatchObject({ status: 'approved', suspendedReason: null })
    expect((await accounts.findById(approved.ownerUserId))?.banned).toBe(false)
    expect(await sessionFor(await signIn(input.owner.email))).not.toBeNull()

    // A seller suspended before approval goes back to pending.
    const pending = await createSeller(services, admin, sellerInput())
    await suspendSeller(services, admin, pending.id, { reason: 'Checking' })
    expect((await reinstateSeller(services, admin, pending.id)).status).toBe(
      'pending',
    )
  })

  test('hides the seller’s listings from visitors until reinstated', async () => {
    const seller = await createSeller(services, admin, sellerInput())
    await approveSeller(web, admin, seller.id)
    const category = await createTestCategory(owner)
    const { product } = await createTestProduct(owner, {
      sellerId: seller.id,
      categoryId: category.id,
    })
    const visible = () =>
      withContext(
        web,
        { role: 'anonymous' },
        async (tx) =>
          (
            await tx
              .select({ id: products.id })
              .from(products)
              .where(eq(products.id, product.id))
          ).length,
      )

    expect(await visible()).toBe(1)
    await suspendSeller(services, admin, seller.id, { reason: 'Checking' })
    expect(await visible()).toBe(0)
    await reinstateSeller(services, admin, seller.id)
    expect(await visible()).toBe(1)
  })
})

describe('updateSeller', () => {
  test('changes details and audits only what changed', async () => {
    const seller = await createSeller(services, admin, sellerInput())
    const updated = await updateSeller(web, admin, seller.id, {
      city: 'Mumbai',
      pincode: '400001',
    })
    expect(updated).toMatchObject({ city: 'Mumbai', pincode: '400001' })
    expect(updated.slug).toBe(seller.slug)
    expect((await auditFor(seller.id)).at(-1)).toMatchObject({
      action: 'seller.update',
      before: { city: 'Pune', pincode: '411001' },
      after: { city: 'Mumbai', pincode: '400001' },
    })
  })

  test('keeps the tax rules across fields', async () => {
    const seller = await createSeller(services, admin, sellerInput())
    expect(
      await validationIssues(
        updateSeller(web, admin, seller.id, { stateCode: '29' }),
      ),
    ).toEqual(['gstin must start with the state code of the address (29)'])

    await approveSeller(web, admin, seller.id)
    expect(
      await validationIssues(
        updateSeller(web, admin, seller.id, { gstin: null }),
      ),
    ).toEqual(['gstin is needed while the seller is approved'])
  })

  test('fixes the invoice prefix once the first invoice exists', async () => {
    const seller = await createSeller(services, admin, sellerInput())
    const prefix = randomLetters(6)
    expect(
      (await updateSeller(web, admin, seller.id, { invoicePrefix: prefix }))
        .invoicePrefix,
    ).toBe(prefix)

    await owner
      .update(sellers)
      .set({ invoiceSeq: 1 })
      .where(eq(sellers.id, seller.id))
    await expect(
      updateSeller(web, admin, seller.id, { invoicePrefix: randomLetters(6) }),
    ).rejects.toThrow(ConflictError)
  })

  test('refuses an empty change', async () => {
    const seller = await createSeller(services, admin, sellerInput())
    await expect(updateSeller(web, admin, seller.id, {})).rejects.toThrow(
      'There is nothing to change',
    )
  })
})

describe('the seller’s own details', () => {
  test('a seller sees their business and changes their contacts', async () => {
    const seller = await createSeller(services, admin, sellerInput())
    const context: RequestContext = {
      role: 'seller',
      userId: seller.ownerUserId,
      sellerId: seller.id,
    }
    expect((await getOwnSeller(web, context)).id).toBe(seller.id)

    const updated = await updateOwnContacts(web, context, {
      supportPhone: '+919812345678',
    })
    expect(updated.supportPhone).toBe('+919812345678')
    expect((await auditFor(seller.id)).at(-1)).toMatchObject({
      action: 'seller.update_contacts',
      actorUserId: seller.ownerUserId,
      actorRole: 'seller',
      after: { supportPhone: '+919812345678' },
    })
  })

  test('a seller cannot change legal or tax details', async () => {
    const seller = await createSeller(services, admin, sellerInput())
    const context: RequestContext = {
      role: 'seller',
      userId: seller.ownerUserId,
      sellerId: seller.id,
    }
    const issues = await validationIssues(
      updateOwnContacts(web, context, { gstin: '27AABCG1234K1Z9' }),
    )
    expect(issues).toEqual(['gstin is not allowed here'])
    await expect(
      updateOwnContacts(web, admin, { supportPhone: '+919812345678' }),
    ).rejects.toThrow(ForbiddenError)
  })
})

describe('getSeller and listSellers', () => {
  test('an administrator sees the owner account with the business', async () => {
    const input = sellerInput()
    const seller = await createSeller(services, admin, input)
    expect((await getSeller(services, admin, seller.id)).owner).toEqual({
      email: input.owner.email,
      name: 'Ravi Kumar',
      phoneNumber: null,
      banned: false,
      banReason: null,
    })
  })

  test('pages through every seller once, newest first, and filters by status', async () => {
    const created = []
    for (let i = 0; i < 3; i++) {
      created.push((await createSeller(services, admin, sellerInput())).id)
    }
    await suspendSeller(services, admin, created[1]!, { reason: 'Checking' })

    const seen: { id: string; createdAt: Date }[] = []
    let cursor: string | undefined
    do {
      const page = await listSellers(web, admin, { cursor, limit: 2 })
      expect(page.items.length).toBeLessThanOrEqual(2)
      seen.push(...page.items)
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    expect(new Set(seen.map((s) => s.id)).size).toBe(seen.length)
    expect(seen.map((s) => s.id)).toEqual(expect.arrayContaining(created))
    const times = seen.map((s) => s.createdAt.getTime())
    expect(times).toEqual(times.toSorted((a, b) => b - a))

    const suspended = await listSellers(web, admin, {
      status: 'suspended',
      limit: 100,
    })
    expect(suspended.items.every((s) => s.status === 'suspended')).toBe(true)
    expect(suspended.items.map((s) => s.id)).toContain(created[1])
  })

  test('refuses a bad status, a bad cursor, and non-administrators', async () => {
    await expect(listSellers(web, admin, { status: 'banned' })).rejects.toThrow(
      ValidationError,
    )
    await expect(
      listSellers(web, admin, { cursor: 'nonsense' }),
    ).rejects.toThrow('That page cursor is not valid')
    await expect(listSellers(web, { role: 'anonymous' })).rejects.toThrow(
      ForbiddenError,
    )
  })
})

// Three sellers created within one millisecond, one page at a time. A cursor
// rounded to milliseconds would skip the second and third.
test('the list cursor keeps microseconds', async () => {
  const times = [
    '2020-01-01T00:00:00.000300Z',
    '2020-01-01T00:00:00.000200Z',
    '2020-01-01T00:00:00.000100Z',
  ]
  const ids: string[] = []
  for (const time of times) {
    const user = await createTestUser(owner, 'seller')
    const [row] = await owner
      .insert(sellers)
      .values({
        ...sellerInput(),
        ownerUserId: user.id,
        slug: `micro-${randomLetters(10).toLowerCase()}`,
        createdAt: sql`${time}::timestamptz`,
      })
      .returning({ id: sellers.id })
    ids.push(row!.id)
  }

  // Start just after anything created later than these three.
  let cursor: string | undefined = encodeCursor(
    '2020-01-01T00:00:00.000400Z',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
  )
  const seen: string[] = []
  while (cursor) {
    const page = await listSellers(web, admin, { cursor, limit: 1 })
    seen.push(...page.items.map((item) => item.id))
    cursor = page.nextCursor ?? undefined
  }
  expect(seen).toEqual(ids)
})
