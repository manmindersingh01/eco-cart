import { randomBytes } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import {
  auditLogs,
  emailOutbox,
  users,
  verifications,
} from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import { startJobQueue, type JobQueue } from '../../lib/queue.ts'
import {
  lastEmailedCode as readEmailedCode,
  lastTextedCode as readTextedCode,
} from '../../testing/codes.ts'
import { createTestSeller, createTestUser } from '../../testing/fixtures.ts'
import type { Auth } from './auth.ts'
import type { AuthConfig } from './config.ts'
import {
  createAppAuth,
  ensureAdministrator,
  MAX_CODES_PER_RECIPIENT_PER_HOUR,
  resolveRequestContext,
  SellerAccountNotReadyError,
} from './service.ts'

/*
 * Sign-in as a browser does it: HTTP requests to Better Auth's handler, with
 * the codes read back from where the worker would pick them up. Runs as
 * ecokart_web, so row-level security applies exactly as in production.
 */

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'auth-test')
  pools.push(pool)
  return createDatabase(pool)
}
const web = connect(requireEnv('DATABASE_URL'))
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))

const baseURL = 'http://localhost:3000'
const config: AuthConfig = {
  baseURL,
  secret: 'test-secret-for-sessions-0123456789abcdef',
  encryptionKey: randomBytes(32),
  smsOtpEnabled: true,
}
let queue: JobQueue
let auth: Auth

beforeAll(async () => {
  queue = await startJobQueue(requireEnv('DATABASE_URL'), 'auth-test')
  auth = createAppAuth({ db: web, getQueue: async () => queue, config })
})

afterAll(async () => {
  await queue.stop()
  await Promise.all(pools.map((pool) => pool.end()))
})

// Rate limits count per IP address, so each test uses its own.
let ipCounter = 0
const ipBase = Math.floor(Math.random() * 200)
const nextIp = () => `198.51.${ipBase}.${++ipCounter}`
const newEmail = () => `${crypto.randomUUID()}@example.test`
const newMobile = () =>
  `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`

interface CallOptions {
  ip?: string
  cookie?: string
  method?: 'GET' | 'POST'
}

async function call(
  authInstance: Auth,
  path: string,
  body?: object,
  options: CallOptions = {},
): Promise<Response> {
  const headers = new Headers({
    origin: baseURL,
    'x-forwarded-for': options.ip ?? nextIp(),
  })
  if (body) headers.set('content-type', 'application/json')
  if (options.cookie) headers.set('cookie', options.cookie)
  return authInstance.handler(
    new Request(`${baseURL}/api/auth${path}`, {
      method: options.method ?? 'POST',
      headers,
      body: body ? JSON.stringify(body) : null,
    }),
  )
}

const sessionCookie = (response: Response) =>
  response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith('ecokart.session_token='))
    ?.split(';')[0]

const lastEmailedCode = (email: string) =>
  readEmailedCode(owner, email, config.encryptionKey)
const lastTextedCode = (phoneNumber: string) =>
  readTextedCode(owner, phoneNumber, config.encryptionKey)

/** Signs in with an email code and returns the session cookie. */
async function signInByEmail(email: string): Promise<string> {
  const ip = nextIp()
  const sent = await call(
    auth,
    '/email-otp/send-verification-otp',
    { email, type: 'sign-in' },
    { ip },
  )
  expect(sent.status).toBe(200)
  const signedIn = await call(
    auth,
    '/sign-in/email-otp',
    { email, otp: await lastEmailedCode(email) },
    { ip },
  )
  expect(signedIn.status).toBe(200)
  return sessionCookie(signedIn)!
}

const sessionFor = (cookie: string) =>
  auth.api.getSession({ headers: new Headers({ cookie }) })

describe('email sign-in', () => {
  test('a new email gets a code by email and signing in creates a buyer', async () => {
    const email = newEmail()
    const cookie = await signInByEmail(email)

    const session = await sessionFor(cookie)
    expect(session?.user).toMatchObject({
      email,
      emailVerified: true,
      role: 'buyer',
    })
    expect(await resolveRequestContext(web, session!.user)).toEqual({
      role: 'buyer',
      userId: session!.user.id,
    })
  })

  test('the queued email holds the code only in encrypted form', async () => {
    const email = newEmail()
    await call(auth, '/email-otp/send-verification-otp', {
      email,
      type: 'sign-in',
    })
    const code = await lastEmailedCode(email)
    const [row] = await owner
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.toEmail, email))
    expect(row).toMatchObject({ template: 'otp', status: 'queued' })
    expect(JSON.stringify(row!.payload)).not.toContain(code)
  })

  test('three wrong codes use the code up', async () => {
    const email = newEmail()
    const ip = nextIp()
    await call(
      auth,
      '/email-otp/send-verification-otp',
      { email, type: 'sign-in' },
      { ip },
    )
    const code = await lastEmailedCode(email)
    const wrong = code === '000000' ? '111111' : '000000'
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await call(
        auth,
        '/sign-in/email-otp',
        { email, otp: wrong },
        { ip },
      )
      expect(response.status).toBe(400)
    }
    const late = await call(
      auth,
      '/sign-in/email-otp',
      { email, otp: code },
      { ip },
    )
    expect(late.status).toBeGreaterThanOrEqual(400)
    expect(sessionCookie(late)).toBeUndefined()
  })

  test(`at most ${MAX_CODES_PER_RECIPIENT_PER_HOUR} codes per address per hour, from any IP`, async () => {
    const email = newEmail()
    const statuses: number[] = []
    for (let i = 0; i <= MAX_CODES_PER_RECIPIENT_PER_HOUR; i++) {
      const response = await call(auth, '/email-otp/send-verification-otp', {
        email,
        type: 'sign-in',
      })
      statuses.push(response.status)
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429])
  })

  test('at most 5 code requests per minute from one IP address', async () => {
    const ip = nextIp()
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      const response = await call(
        auth,
        '/email-otp/send-verification-otp',
        { email: newEmail(), type: 'sign-in' },
        { ip },
      )
      statuses.push(response.status)
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429])
  })
})

describe('phone sign-in', () => {
  test('a new Indian mobile number signs in as a buyer with a placeholder email', async () => {
    const phoneNumber = newMobile()
    const ip = nextIp()
    const sent = await call(
      auth,
      '/phone-number/send-otp',
      { phoneNumber },
      { ip },
    )
    expect(sent.status).toBe(200)

    const verified = await call(
      auth,
      '/phone-number/verify',
      { phoneNumber, code: await lastTextedCode(phoneNumber) },
      { ip },
    )
    expect(verified.status).toBe(200)
    const session = await sessionFor(sessionCookie(verified)!)
    expect(session?.user).toMatchObject({
      phoneNumber,
      phoneNumberVerified: true,
      role: 'buyer',
      email: `${phoneNumber.slice(1)}@phone.ecokart.invalid`,
    })
  })

  test(`at most ${MAX_CODES_PER_RECIPIENT_PER_HOUR} codes per number per hour, from any IP`, async () => {
    const phoneNumber = newMobile()
    const statuses: number[] = []
    for (let i = 0; i <= MAX_CODES_PER_RECIPIENT_PER_HOUR; i++) {
      const response = await call(auth, '/phone-number/send-otp', {
        phoneNumber,
      })
      statuses.push(response.status)
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429])
  })

  test('refuses numbers outside India', async () => {
    const response = await call(auth, '/phone-number/send-otp', {
      phoneNumber: '+14155550100',
    })
    expect(response.status).toBe(400)
  })

  test('is switched off without an SMS provider', async () => {
    const withoutSms = createAppAuth({
      db: web,
      getQueue: async () => queue,
      config: { ...config, smsOtpEnabled: false },
    })
    const response = await call(withoutSms, '/phone-number/send-otp', {
      phoneNumber: newMobile(),
    })
    expect(response.status).toBe(404)
  })
})

/** Signs in with a text message code and returns the session cookie. */
async function signInByPhone(phoneNumber: string): Promise<string> {
  const ip = nextIp()
  expect(
    (await call(auth, '/phone-number/send-otp', { phoneNumber }, { ip }))
      .status,
  ).toBe(200)
  const verified = await call(
    auth,
    '/phone-number/verify',
    { phoneNumber, code: await lastTextedCode(phoneNumber) },
    { ip },
  )
  expect(verified.status).toBe(200)
  return sessionCookie(verified)!
}

/** Adds a phone number to the signed-in account, as the profile page does. */
async function addPhone(cookie: string, phoneNumber: string) {
  const ip = nextIp()
  await call(auth, '/phone-number/send-otp', { phoneNumber }, { ip })
  return call(
    auth,
    '/phone-number/verify',
    {
      phoneNumber,
      code: await lastTextedCode(phoneNumber),
      updatePhoneNumber: true,
    },
    { ip, cookie },
  )
}

/** Adds an email to the signed-in account, as the profile page does. */
async function addEmail(cookie: string, email: string) {
  const ip = nextIp()
  const requested = await call(
    auth,
    '/email-otp/request-email-change',
    { newEmail: email },
    { ip, cookie },
  )
  if (requested.status !== 200) return requested
  return call(
    auth,
    '/email-otp/change-email',
    { newEmail: email, otp: await lastEmailedCode(email) },
    { ip, cookie },
  )
}

const errorOf = async (response: Response) => ({
  status: response.status,
  body: await response.json(),
})

describe('used and expired codes', () => {
  test('Better Auth removes them by itself, so they need no clean-up job', async () => {
    const expired = `sign-in-otp-${newEmail()}`
    await owner.insert(verifications).values({
      identifier: expired,
      value: 'a code nobody used',
      expiresAt: new Date(Date.now() - 60_000),
    })
    const email = newEmail()
    const pending = `sign-in-otp-${email}`
    const waiting = () =>
      owner
        .select({ identifier: verifications.identifier })
        .from(verifications)
        .where(inArray(verifications.identifier, [expired, pending]))

    const ip = nextIp()
    await call(
      auth,
      '/email-otp/send-verification-otp',
      { email, type: 'sign-in' },
      { ip },
    )
    expect((await waiting()).map(({ identifier }) => identifier)).toContain(
      pending,
    )
    const signedIn = await call(
      auth,
      '/sign-in/email-otp',
      { email, otp: await lastEmailedCode(email) },
      { ip },
    )
    expect(signedIn.status).toBe(200)
    // The used code is gone, and checking it removed every expired code.
    expect(await waiting()).toEqual([])
  })
})

describe('a buyer adds a phone number or an email', () => {
  test('an email buyer adds a phone number with a code, then signs in with it', async () => {
    const email = newEmail()
    const cookie = await signInByEmail(email)
    const phoneNumber = newMobile()

    expect((await addPhone(cookie, phoneNumber)).status).toBe(200)
    const session = await sessionFor(cookie)
    expect(session?.user).toMatchObject({
      email,
      phoneNumber,
      phoneNumberVerified: true,
    })
    const byPhone = await sessionFor(await signInByPhone(phoneNumber))
    expect(byPhone?.user.id).toBe(session!.user.id)
  })

  test('a phone buyer adds an email with a code sent to it, then signs in with it', async () => {
    const phoneNumber = newMobile()
    const cookie = await signInByPhone(phoneNumber)
    const email = newEmail()

    expect((await addEmail(cookie, email)).status).toBe(200)
    const session = await sessionFor(cookie)
    expect(session?.user).toMatchObject({
      email,
      emailVerified: true,
      phoneNumber,
    })
    const byEmail = await sessionFor(await signInByEmail(email))
    expect(byEmail?.user.id).toBe(session!.user.id)
  })

  test('a buyer never removes the phone number that is their only way to sign in', async () => {
    const phoneNumber = newMobile()
    const cookie = await signInByPhone(phoneNumber)
    const removePhone = () =>
      call(auth, '/update-user', { phoneNumber: null }, { cookie })

    expect(await errorOf(await removePhone())).toMatchObject({
      status: 403,
      body: {
        message:
          'Your phone number is the only way you sign in, so it cannot be removed; add an email address first',
      },
    })
    expect((await sessionFor(cookie))?.user.phoneNumber).toBe(phoneNumber)

    // With an email to sign in with, the phone number may go.
    expect((await addEmail(cookie, newEmail())).status).toBe(200)
    expect((await removePhone()).status).toBe(200)
    expect((await sessionFor(cookie))?.user.phoneNumber).toBeNull()
  })

  test('adds only what is missing, and only for buyers', async () => {
    const emailBuyer = await signInByEmail(newEmail())
    expect(await errorOf(await addEmail(emailBuyer, newEmail()))).toMatchObject(
      {
        status: 403,
        body: { message: 'This account already has an email address' },
      },
    )
    const phoneBuyer = await signInByPhone(newMobile())
    expect(
      await errorOf(await addPhone(phoneBuyer, newMobile())),
    ).toMatchObject({
      status: 403,
      body: { message: 'This account already has a phone number' },
    })
    const { owner: sellerOwner } = await createTestSeller(owner)
    const seller = await signInByEmail(sellerOwner.email)
    expect(await errorOf(await addPhone(seller, newMobile()))).toMatchObject({
      status: 403,
      body: {
        message:
          'Only buyer accounts can add a phone number or an email address here',
      },
    })
    const signedOut = await call(auth, '/email-otp/request-email-change', {
      newEmail: newEmail(),
    })
    expect(signedOut.status).toBe(401)
  })

  test("never takes another account's email or phone number", async () => {
    const takenEmail = newEmail()
    await signInByEmail(takenEmail)
    const takenPhone = newMobile()
    await signInByPhone(takenPhone)

    const phoneBuyer = await signInByPhone(newMobile())
    const ip = nextIp()
    // Better Auth answers as usual, so nobody learns the address is taken,
    // but sends no code, and no code can complete the change.
    expect(
      (
        await call(
          auth,
          '/email-otp/request-email-change',
          { newEmail: takenEmail },
          { ip, cookie: phoneBuyer },
        )
      ).status,
    ).toBe(200)
    const changed = await call(
      auth,
      '/email-otp/change-email',
      { newEmail: takenEmail, otp: await lastEmailedCode(takenEmail) },
      { ip, cookie: phoneBuyer },
    )
    expect(changed.status).toBe(400)

    const emailBuyer = await signInByEmail(newEmail())
    expect((await addPhone(emailBuyer, takenPhone)).status).toBe(400)
    expect((await sessionFor(emailBuyer))?.user.phoneNumber).toBeNull()
  })
})

describe('endpoints EcoKart does not use', () => {
  test.each([
    '/sign-in/phone-number',
    '/phone-number/request-password-reset',
    '/phone-number/reset-password',
    '/email-otp/request-password-reset',
    '/email-otp/reset-password',
    '/forget-password/email-otp',
  ])('%s answers 404', async (path) => {
    expect((await call(auth, path, {})).status).toBe(404)
  })

  test('a user cannot change their own role or phone number', async () => {
    const email = newEmail()
    const cookie = await signInByEmail(email)
    await call(
      auth,
      '/update-user',
      { role: 'admin', phoneNumber: '+919800000000' },
      { cookie },
    )
    const [user] = await owner
      .select({ role: users.role, phoneNumber: users.phoneNumber })
      .from(users)
      .where(eq(users.email, email))
    expect(user).toEqual({ role: 'buyer', phoneNumber: null })
  })
})

describe('request context', () => {
  test('a seller account carries its seller id', async () => {
    const { owner: sellerUser, seller } = await createTestSeller(owner)
    expect(await resolveRequestContext(web, sellerUser)).toEqual({
      role: 'seller',
      userId: sellerUser.id,
      sellerId: seller.id,
    })
  })

  test('a seller account without a seller business is refused', async () => {
    const sellerUser = await createTestUser(owner, 'seller')
    await expect(resolveRequestContext(web, sellerUser)).rejects.toThrow(
      SellerAccountNotReadyError,
    )
  })

  test('administrators and visitors', async () => {
    const admin = await createTestUser(owner, 'admin')
    expect(await resolveRequestContext(web, admin)).toEqual({
      role: 'admin',
      userId: admin.id,
    })
    expect(await resolveRequestContext(web, null)).toEqual({
      role: 'anonymous',
    })
  })
})

const auditFor = (entityId: string) =>
  owner
    .select({
      actorUserId: auditLogs.actorUserId,
      actorRole: auditLogs.actorRole,
      action: auditLogs.action,
      after: auditLogs.after,
      ip: auditLogs.ip,
    })
    .from(auditLogs)
    .where(eq(auditLogs.entityId, entityId))
    .orderBy(auditLogs.id)

describe('administration', () => {
  let adminEmail: string
  let adminCreation: Awaited<ReturnType<typeof ensureAdministrator>>
  let adminCookie: string

  beforeAll(async () => {
    adminEmail = newEmail()
    adminCreation = await ensureAdministrator(auth, web, {
      email: adminEmail,
      name: 'Meera Admin',
    })
    adminCookie = await signInByEmail(adminEmail)
  })

  test('creating the first administrator is audited as the system', async () => {
    expect(adminCreation).toBe('created')
    const [admin] = await owner
      .select({
        id: users.id,
        role: users.role,
        emailVerified: users.emailVerified,
      })
      .from(users)
      .where(eq(users.email, adminEmail))
    expect(admin).toMatchObject({ role: 'admin', emailVerified: true })
    expect(await auditFor(admin!.id)).toEqual([
      expect.objectContaining({
        actorUserId: null,
        actorRole: 'system',
        action: 'user.create',
      }),
    ])
  })

  test('promoting an existing account, once', async () => {
    const email = newEmail()
    await signInByEmail(email)
    expect(await ensureAdministrator(auth, web, { email, name: 'x' })).toBe(
      'promoted',
    )
    expect(await ensureAdministrator(auth, web, { email, name: 'x' })).toBe(
      'unchanged',
    )
  })

  test("never promotes a seller business's owner", async () => {
    const { owner: sellerUser } = await createTestSeller(owner)
    await expect(
      ensureAdministrator(auth, web, { email: sellerUser.email, name: 'x' }),
    ).rejects.toThrow(
      'This account owns a seller business, so it cannot become an administrator; use another email address',
    )
    const [still] = await owner
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, sellerUser.id))
    expect(still).toEqual({ role: 'seller' })
  })

  test('an administrator sets a role, and it is audited with who and from where', async () => {
    const buyer = await createTestUser(owner, 'buyer')
    const admin = (await sessionFor(adminCookie))!.user
    const response = await call(
      auth,
      '/admin/set-role',
      { userId: buyer.id, role: 'admin' },
      { cookie: adminCookie, ip: '203.0.113.9' },
    )
    expect(response.status).toBe(200)
    expect(await auditFor(buyer.id)).toEqual([
      {
        actorUserId: admin.id,
        actorRole: 'admin',
        action: 'user.set_role',
        after: { userId: buyer.id, role: 'admin' },
        ip: '203.0.113.9',
      },
    ])
  })

  test('a buyer cannot use administrator endpoints', async () => {
    const buyerCookie = await signInByEmail(newEmail())
    const target = await createTestUser(owner, 'buyer')
    const response = await call(
      auth,
      '/admin/set-role',
      { userId: target.id, role: 'admin' },
      { cookie: buyerCookie },
    )
    expect(response.status).toBe(403)
    expect(await auditFor(target.id)).toEqual([])
  })

  test('administrators cannot impersonate, delete, or set passwords', async () => {
    const target = await createTestUser(owner, 'buyer')
    for (const path of [
      '/admin/impersonate-user',
      '/admin/remove-user',
      '/admin/set-user-password',
    ]) {
      const response = await call(
        auth,
        path,
        { userId: target.id, newPassword: 'not-allowed-1234' },
        { cookie: adminCookie },
      )
      expect({ path, status: response.status }).toEqual({ path, status: 403 })
    }
  })

  test('the seller role only comes from the seller onboarding', async () => {
    const buyer = await createTestUser(owner, 'buyer')
    const viaSetRole = await call(
      auth,
      '/admin/set-role',
      { userId: buyer.id, role: 'seller' },
      { cookie: adminCookie },
    )
    expect(viaSetRole.status).toBe(400)
    expect(await viaSetRole.json()).toMatchObject({
      message:
        'The seller role comes only with a seller business: create the seller, or approve the account’s seller application',
    })

    const viaCreateUser = await call(
      auth,
      '/admin/create-user',
      { email: newEmail(), name: 'New seller', role: 'seller' },
      { cookie: adminCookie },
    )
    expect(viaCreateUser.status).toBe(400)
  })

  test('an account an administrator creates starts with its email verified', async () => {
    const email = newEmail()
    const response = await call(
      auth,
      '/admin/create-user',
      // Even when the request says otherwise.
      {
        email,
        name: 'Meera Iyer',
        role: 'admin',
        data: { emailVerified: false },
      },
      { cookie: adminCookie },
    )
    expect(response.status).toBe(200)
    const [created] = await owner
      .select({ emailVerified: users.emailVerified, role: users.role })
      .from(users)
      .where(eq(users.email, email))
    expect(created).toEqual({ emailVerified: true, role: 'admin' })
  })

  test('the role of an account that owns a seller business cannot change', async () => {
    const { owner: sellerUser } = await createTestSeller(owner)
    const response = await call(
      auth,
      '/admin/set-role',
      { userId: sellerUser.id, role: 'buyer' },
      { cookie: adminCookie },
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      message: 'This account owns a seller business, so its role cannot change',
    })
  })

  test('only the three EcoKart roles can be given', async () => {
    const target = await createTestUser(owner, 'buyer')
    const response = await call(
      auth,
      '/admin/set-role',
      { userId: target.id, role: 'superuser' },
      { cookie: adminCookie },
    )
    expect(response.status).toBe(400)
  })

  test('a banned user loses their sessions and cannot sign in again', async () => {
    const email = newEmail()
    const cookie = await signInByEmail(email)
    const user = (await sessionFor(cookie))!.user

    const banned = await call(
      auth,
      '/admin/ban-user',
      { userId: user.id, banReason: 'Fraudulent orders' },
      { cookie: adminCookie },
    )
    expect(banned.status).toBe(200)
    expect(await sessionFor(cookie)).toBeNull()

    const ip = nextIp()
    await call(
      auth,
      '/email-otp/send-verification-otp',
      { email, type: 'sign-in' },
      { ip },
    )
    const again = await call(
      auth,
      '/sign-in/email-otp',
      { email, otp: await lastEmailedCode(email) },
      { ip },
    )
    expect(again.status).toBe(403)
    expect(await auditFor(user.id)).toEqual([
      expect.objectContaining({
        action: 'user.ban',
        after: { userId: user.id, banReason: 'Fraudulent orders' },
      }),
    ])
  })
})

// The audit rows above are written by Better Auth's after-hook, outside its
// own transaction; this makes sure nothing else wrote to them.
test('audit entries are only written for administrator actions', async () => {
  const email = newEmail()
  const cookie = await signInByEmail(email)
  const user = (await sessionFor(cookie))!.user
  const rows = await owner
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(and(eq(auditLogs.entityId, user.id)))
  expect(rows).toEqual([])
})
