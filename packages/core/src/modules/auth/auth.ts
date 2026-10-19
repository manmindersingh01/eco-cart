import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from 'better-auth/api'
import { admin, emailOTP, phoneNumber } from 'better-auth/plugins'
import { createAccessControl } from 'better-auth/plugins/access'
import { defaultStatements } from 'better-auth/plugins/admin/access'
import { clientAddress } from '../../lib/client-address.ts'
import type { AuditEntry } from '../audit/service.ts'
import type { EmailOtpPurpose } from '../notifications/types.ts'

export const OTP_EXPIRES_IN_SECONDS = 5 * 60

/** One role per account (design doc 11). */
export type AccountRole = 'buyer' | 'seller' | 'admin'

const accessControl = createAccessControl(defaultStatements)

/**
 * What each role may do through Better Auth's admin endpoints. Buyers and
 * sellers may do nothing there. Administrators manage accounts, but may not
 * impersonate, delete, or set passwords or emails: nothing in the quotation
 * needs those, and each is a risk (backend spec step 2).
 */
export const accountRoles = {
  buyer: accessControl.newRole({ user: [], session: [] }),
  seller: accessControl.newRole({ user: [], session: [] }),
  admin: accessControl.newRole({
    user: ['create', 'list', 'get', 'set-role', 'ban'],
    session: ['list', 'revoke', 'delete'],
  }),
}

/** Indian mobile numbers only, the ones DLT-registered SMS can reach. */
export const isIndianMobileNumber = (value: string) =>
  /^\+91[6-9]\d{9}$/.test(value)

// An account that signs up by phone gets an address here, because Better
// Auth needs an email for every user. `.invalid` can never receive mail.
const PLACEHOLDER_EMAIL_DOMAIN = '@phone.ecokart.invalid'

/** Whether the account's email is the stand-in a phone sign-up gets. */
export const isPlaceholderEmail = (email: string) =>
  email.toLowerCase().endsWith(PLACEHOLDER_EMAIL_DOMAIN)

// EcoKart has no passwords, so these endpoints answer 404.
const UNUSED_PATHS = [
  '/sign-in/phone-number',
  '/phone-number/request-password-reset',
  '/phone-number/reset-password',
  '/email-otp/request-password-reset',
  '/email-otp/reset-password',
  '/forget-password/email-otp',
]
const PHONE_PATHS = ['/phone-number/send-otp', '/phone-number/verify']

// Administrator endpoints that change something, and the audit action each
// one records. Read-only ones (list, get) are not audited.
const AUDITED_ADMIN_ACTIONS: Record<string, string> = {
  '/admin/create-user': 'user.create',
  '/admin/set-role': 'user.set_role',
  '/admin/ban-user': 'user.ban',
  '/admin/unban-user': 'user.unban',
  '/admin/revoke-user-session': 'session.revoke',
  '/admin/revoke-user-sessions': 'session.revoke_all',
}
const SECRET_BODY_FIELDS = new Set(['password', 'sessionToken', 'token'])

/** Who a sign-in code is about to be sent to. */
export interface CodeRecipient {
  channel: 'email' | 'phone'
  /** Lower-cased email address, or E.164 phone number. */
  address: string
}

function codeRecipient(path: string, body: unknown): CodeRecipient | null {
  if (typeof body !== 'object' || body === null) return null
  if (
    path === '/email-otp/send-verification-otp' &&
    'email' in body &&
    typeof body.email === 'string'
  ) {
    return { channel: 'email', address: body.email.trim().toLowerCase() }
  }
  if (
    path === '/phone-number/send-otp' &&
    'phoneNumber' in body &&
    typeof body.phoneNumber === 'string'
  ) {
    return { channel: 'phone', address: body.phoneNumber }
  }
  if (
    path === '/email-otp/request-email-change' &&
    'newEmail' in body &&
    typeof body.newEmail === 'string'
  ) {
    return { channel: 'email', address: body.newEmail.trim().toLowerCase() }
  }
  return null
}

/** The signed-in account as a profile rule needs to see it. */
interface ProfileUser {
  role?: string | null | undefined
  email: string
  emailVerified: boolean
  phoneNumber?: string | null | undefined
}

/**
 * Why a signed-in buyer may not make this change to how they sign in, or
 * null. A buyer adds the missing one of email and phone, each confirmed
 * with a code; a buyer never removes their only way to sign in (backend
 * profile step). Changing an email or phone that is already there is not
 * offered yet.
 */
function profileRefusal(
  path: string,
  body: unknown,
  user: ProfileUser,
): string | null {
  const fields: object = typeof body === 'object' && body !== null ? body : {}
  const addsPhone =
    path === '/phone-number/verify' &&
    'updatePhoneNumber' in fields &&
    fields.updatePhoneNumber === true
  const addsEmail =
    path === '/email-otp/request-email-change' ||
    path === '/email-otp/change-email'
  const removesPhone =
    path === '/update-user' &&
    'phoneNumber' in fields &&
    fields.phoneNumber === null

  if ((addsPhone || addsEmail) && user.role !== 'buyer') {
    return 'Only buyer accounts can add a phone number or an email address here'
  }
  if (addsPhone && user.phoneNumber) {
    return 'This account already has a phone number'
  }
  if (addsEmail && !isPlaceholderEmail(user.email)) {
    return 'This account already has an email address'
  }
  if (
    removesPhone &&
    user.phoneNumber &&
    (isPlaceholderEmail(user.email) || !user.emailVerified)
  ) {
    return 'Your phone number is the only way you sign in, so it cannot be removed; add an email address first'
  }
  return null
}

const PROFILE_PATHS = new Set([
  '/phone-number/verify',
  '/email-otp/request-email-change',
  '/email-otp/change-email',
  '/update-user',
])

/** The roles a request asks Better Auth's admin endpoints to give. */
function requestedRoles(path: string, body: unknown): string[] {
  if (path !== '/admin/set-role' && path !== '/admin/create-user') return []
  if (typeof body !== 'object' || body === null) return []
  const data =
    'data' in body && typeof body.data === 'object' ? body.data : null
  const fromData = data && 'role' in data ? data.role : undefined
  const role = 'role' in body ? body.role : fromData
  if (typeof role === 'string') return [role]
  return Array.isArray(role)
    ? role.filter((r): r is string => typeof r === 'string')
    : []
}

export interface AuthDependencies {
  /** A Drizzle database whose schema includes the Better Auth tables. */
  db: Parameters<typeof drizzleAdapter>[0]
  baseURL: string
  secret: string
  /** False until an SMS provider is configured; phone sign-in answers 404. */
  smsOtpEnabled: boolean
  /** Queues the OTP email. Must never send inline (CLAUDE.md, design doc 6.1). */
  sendEmailOtp: (message: {
    email: string
    otp: string
    purpose: EmailOtpPurpose
    expiresAt: Date
  }) => Promise<void>
  /** Queues the OTP SMS. Must never send inline. */
  sendSmsOtp: (message: {
    phoneNumber: string
    code: string
    expiresAt: Date
  }) => Promise<void>
  /**
   * Counts a code request for one recipient and answers whether it is
   * allowed, so one inbox or phone cannot be flooded from many IP addresses.
   */
  allowCodeRequest: (recipient: CodeRecipient) => Promise<boolean>
  /** Writes the audit entry for a successful administrator action. */
  recordAdminAction: (entry: AuditEntry) => Promise<void>
  /** Whether the account owns a seller business (backend spec step 4). */
  ownsSellerBusiness: (userId: string) => Promise<boolean>
  /**
   * Better Auth checks at runtime that the database has its tables. Only the
   * schema generation config turns this off, because it has no database.
   */
  validateSchema?: boolean
}

const otpExpiry = () => new Date(Date.now() + OTP_EXPIRES_IN_SECONDS * 1000)

function auditedBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null) return {}
  return Object.fromEntries(
    Object.entries(body).filter(([key]) => !SECRET_BODY_FIELDS.has(key)),
  )
}

function createdUserId(returned: unknown): string | undefined {
  if (typeof returned !== 'object' || returned === null) return undefined
  const user = 'user' in returned ? returned.user : undefined
  if (typeof user !== 'object' || user === null || !('id' in user)) {
    return undefined
  }
  return typeof user.id === 'string' ? user.id : undefined
}

/**
 * Better Auth configuration (design doc 3, 5.3, 6.1, backend spec step 2).
 * The options here also decide the shape of Better Auth's tables, so after
 * changing a plugin run `pnpm auth:schema` and then `pnpm db:generate`.
 */
export function createAuth(dependencies: AuthDependencies) {
  return betterAuth({
    baseURL: dependencies.baseURL,
    secret: dependencies.secret,
    trustedOrigins: [dependencies.baseURL],
    database: drizzleAdapter(dependencies.db, {
      provider: 'pg',
      usePlural: true,
    }),
    disabledPaths: dependencies.smsOtpEnabled
      ? UNUSED_PATHS
      : [...UNUSED_PATHS, ...PHONE_PATHS],
    advanced: {
      cookiePrefix: 'ecokart',
      database: {
        generateId: 'uuid',
        validateSchema: dependencies.validateSchema ?? true,
      },
    },
    // On everywhere, and kept in the database so the limits hold across web
    // containers. Better Auth adds the table auth_rate_limits for this.
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'authRateLimit',
      customRules: {
        '/email-otp/send-verification-otp': { window: 60, max: 5 },
        '/phone-number/send-otp': { window: 60, max: 5 },
        '/sign-in/email-otp': { window: 60, max: 10 },
        '/phone-number/verify': { window: 60, max: 10 },
        '/email-otp/request-email-change': { window: 60, max: 5 },
        '/email-otp/change-email': { window: 60, max: 10 },
      },
    },
    hooks: {
      // Checked before Better Auth creates a code. Better Auth logs and
      // ignores errors thrown from the email callback, so a refusal there
      // would never reach the caller.
      before: createAuthMiddleware(async (ctx) => {
        // Seller accounts come only from the seller flow, which also creates
        // the business, so a seller account always has one (backend spec
        // step 4).
        if (requestedRoles(ctx.path, ctx.body).includes('seller')) {
          throw new APIError('BAD_REQUEST', {
            message:
              'Seller accounts are created together with their business in the seller onboarding',
          })
        }
        if (
          ctx.path === '/admin/set-role' &&
          typeof ctx.body?.userId === 'string' &&
          (await dependencies.ownsSellerBusiness(ctx.body.userId))
        ) {
          throw new APIError('BAD_REQUEST', {
            message:
              'This account owns a seller business, so its role cannot change',
          })
        }

        if (PROFILE_PATHS.has(ctx.path)) {
          const session = await getSessionFromCtx(ctx)
          const refusal = session
            ? profileRefusal(ctx.path, ctx.body, session.user)
            : null
          if (refusal) {
            throw new APIError('FORBIDDEN', { message: refusal })
          }
        }

        const recipient = codeRecipient(ctx.path, ctx.body)
        if (recipient && !(await dependencies.allowCodeRequest(recipient))) {
          throw new APIError('TOO_MANY_REQUESTS', {
            message:
              'Too many codes were requested for this address. Try again in an hour.',
          })
        }

        // Every account an administrator creates starts with its email
        // verified, because Better Auth's clean-up of unverified accounts
        // does not work with UUID ids (backend spec step 2). Better Auth's
        // own endpoint would otherwise leave it unverified.
        if (ctx.path === '/admin/create-user') {
          const data: unknown = ctx.body?.data
          return {
            context: {
              body: {
                ...ctx.body,
                data: {
                  ...(typeof data === 'object' ? data : {}),
                  emailVerified: true,
                },
              },
            },
          }
        }
        // Every other request goes ahead unchanged.
        return undefined
      }),
      after: createAuthMiddleware(async (ctx) => {
        const action = AUDITED_ADMIN_ACTIONS[ctx.path]
        if (!action || ctx.context.returned instanceof APIError) return
        // Null when the call came from server code, such as the
        // admin:create script, rather than a signed-in administrator.
        const session = await getSessionFromCtx(ctx)
        const body = auditedBody(ctx.body)
        const targetUserId =
          typeof body.userId === 'string'
            ? body.userId
            : createdUserId(ctx.context.returned)
        await dependencies.recordAdminAction({
          actorUserId: session?.user.id ?? null,
          actorRole: session ? 'admin' : 'system',
          action,
          entityType: 'user',
          entityId: targetUserId ?? 'unknown',
          after: body,
          ip: clientAddress(ctx.request?.headers ?? ctx.headers),
        })
      }),
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: OTP_EXPIRES_IN_SECONDS,
        allowedAttempts: 3,
        storeOTP: 'hashed',
        // Adds an email to an account that signed up by phone: the code goes
        // to the new address. The account's current address is the
        // placeholder, which cannot receive a code, so it is not checked;
        // the hooks above allow this only for such accounts.
        changeEmail: { enabled: true, verifyCurrentEmail: false },
        sendVerificationOTP: ({ email, otp, type }) =>
          dependencies.sendEmailOtp({
            email,
            otp,
            purpose: type,
            expiresAt: otpExpiry(),
          }),
      }),
      phoneNumber({
        otpLength: 6,
        expiresIn: OTP_EXPIRES_IN_SECONDS,
        allowedAttempts: 3,
        phoneNumberValidator: isIndianMobileNumber,
        signUpOnVerification: {
          getTempEmail: (number) =>
            `${number.replace(/^\+/, '')}${PLACEHOLDER_EMAIL_DOMAIN}`,
          getTempName: () => '',
        },
        sendOTP: (message) =>
          dependencies.sendSmsOtp({
            phoneNumber: message.phoneNumber,
            code: message.code,
            expiresAt: otpExpiry(),
          }),
      }),
      admin({
        ac: accessControl,
        roles: accountRoles,
        defaultRole: 'buyer',
        adminRoles: ['admin'],
      }),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
