import type { Database } from '../../db/client.ts'
import { ConflictError, ForbiddenError } from '../../errors.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import type { JobQueue } from '../../lib/queue.ts'
import { recordAuditEntry } from '../audit/service.ts'
import { queueOtpEmail, queueOtpSms } from '../notifications/service.ts'
import { consumeRateLimit, hashedRateLimitKey } from '../rate-limits/service.ts'
import { findSellerForOwner } from '../sellers/service.ts'
import { createAuth, rolesOf, type Auth } from './auth.ts'
import type { AuthConfig } from './config.ts'

/**
 * At most this many codes per email address or phone number per hour, so one
 * inbox or phone cannot be flooded from many IP addresses.
 */
export const MAX_CODES_PER_RECIPIENT_PER_HOUR = 5

export interface AppAuthDependencies {
  /** Connected as ecokart_web. */
  db: Database
  /** Started on first use, so a page that never sends a code never connects. */
  getQueue: () => Promise<JobQueue>
  config: AuthConfig
}

/**
 * Better Auth wired to the rest of EcoKart: codes go to the outbox and job
 * queue encrypted, and administrator actions go to the audit log.
 */
export function createAppAuth({
  db,
  getQueue,
  config,
}: AppAuthDependencies): Auth {
  return createAuth({
    db,
    baseURL: config.baseURL,
    secret: config.secret,
    smsOtpEnabled: config.smsOtpEnabled,
    async allowCodeRequest({ channel, address }) {
      const { allowed } = await withContext(db, { role: 'anonymous' }, (tx) =>
        consumeRateLimit(tx, {
          key: hashedRateLimitKey(`otp:${channel}`, address),
          limit: MAX_CODES_PER_RECIPIENT_PER_HOUR,
          windowSeconds: 60 * 60,
        }),
      )
      return allowed
    },
    async sendEmailOtp({ email, otp, purpose, expiresAt }) {
      const queue = await getQueue()
      await withContext(db, { role: 'anonymous' }, (tx) =>
        queueOtpEmail(tx, queue, config.encryptionKey, {
          email,
          code: otp,
          purpose,
          expiresAt,
        }),
      )
    },
    async sendSmsOtp({ phoneNumber, code, expiresAt }) {
      const queue = await getQueue()
      await withContext(db, { role: 'anonymous' }, (tx) =>
        queueOtpSms(tx, queue, config.encryptionKey, {
          phoneNumber,
          code,
          expiresAt,
        }),
      )
    },
    async ownsSellerBusiness(userId) {
      const seller = await withContext(db, { role: 'system' }, (tx) =>
        findSellerForOwner(tx, userId),
      )
      return seller !== null
    },
    recordAdminAction: (entry) =>
      withContext(
        db,
        entry.actorUserId
          ? { role: 'admin', userId: entry.actorUserId }
          : { role: 'system' },
        (tx) => recordAuditEntry(tx, entry),
      ),
  })
}

/** A seller account whose business has not been set up by an administrator. */
export class SellerAccountNotReadyError extends ForbiddenError {
  override name = 'SellerAccountNotReadyError'
  constructor() {
    super('Seller account is not set up yet')
  }
}

/**
 * A suspended seller. The seller portal refuses them; an account that is
 * also a buyer still shops, and a seller-only account is banned as well.
 */
export class SellerSuspendedError extends ForbiddenError {
  override name = 'SellerSuspendedError'
  constructor() {
    super('This seller account is suspended')
  }
}

/**
 * The part of the app a request is for. One account may be both a buyer and
 * a seller, but a request acts as one of them: seller routes as the seller,
 * everything else as the buyer. So each transaction keeps one `app.role`,
 * and row-level security needs no policy for an account with two roles.
 */
export type RequestArea = 'buyer' | 'seller'

/**
 * Turns a signed-in user (or nobody) into the row-level security context for
 * their requests in `area` (design doc 6.1 step 5).
 *
 * For example, Ravi, who buys and sells, gets
 * `{ role: 'seller', userId: <Ravi>, sellerId: <Ravi's shop> }` in the
 * seller portal, so every query there can only reach his own products and
 * order lines, and `{ role: 'buyer', userId: <Ravi> }` at the checkout. An
 * account that is only a seller acts as the seller everywhere.
 *
 * With `applicants`, a buyer whose seller application is pending or was
 * rejected acts for that business too, in the few seller routes an
 * application needs, such as uploading the documents an administrator asked
 * for. Anywhere else in the seller area they act as the buyer they are, and
 * the seller routes refuse them.
 */
export async function resolveRequestContext(
  db: Database,
  user: { id: string; role?: string | null | undefined } | null,
  area: RequestArea = 'buyer',
  { applicants = false }: { applicants?: boolean } = {},
): Promise<RequestContext> {
  if (!user) return { role: 'anonymous' }
  const roles = rolesOf(user.role)
  if (roles.includes('admin')) return { role: 'admin', userId: user.id }
  const buyer: RequestContext = { role: 'buyer', userId: user.id }
  if (area === 'buyer' && roles.includes('buyer')) return buyer
  if (!roles.includes('seller') && !applicants) return buyer

  // An ordinary signed-in context is enough: the sellers policy lets a user
  // read the seller business they own.
  const seller = await withContext(db, buyer, (tx) =>
    findSellerForOwner(tx, user.id),
  )
  if (!roles.includes('seller')) {
    return seller &&
      (seller.status === 'pending' || seller.status === 'rejected')
      ? { role: 'seller', userId: user.id, sellerId: seller.id }
      : buyer
  }
  if (!seller) throw new SellerAccountNotReadyError()
  if (seller.status === 'suspended') throw new SellerSuspendedError()
  return { role: 'seller', userId: user.id, sellerId: seller.id }
}

/**
 * Makes `email` an administrator: creates the account if it does not exist,
 * or promotes it. Used by `pnpm admin:create` to set up the first
 * administrator, who then signs in with an email code.
 */
export async function ensureAdministrator(
  auth: Auth,
  db: Database,
  account: { email: string; name: string },
): Promise<'created' | 'promoted' | 'unchanged'> {
  const email = account.email.trim().toLowerCase()
  const context = await auth.$context
  const existing = await context.internalAdapter.findUserByEmail(email)
  if (!existing) {
    // Without request headers Better Auth treats this as trusted server code;
    // its audit hook records the action with the actor `system`.
    //
    // The email is marked verified because a new account has no sessions or
    // sign-in links that predate proof of the mailbox. Otherwise Better Auth
    // runs its "unproven account" cleanup on the first sign-in, whose lock
    // does not hold with UUID ids (backend spec step 2, open points). The
    // first sign-in still proves the mailbox, because it needs a code sent
    // to it.
    await auth.api.createUser({
      body: {
        email,
        name: account.name,
        role: 'admin',
        data: { emailVerified: true },
      },
    })
    return 'created'
  }
  const { user } = existing
  if ('role' in user && user.role === 'admin') return 'unchanged'
  // An administrator has only the admin role, and a seller account always
  // has its business (backend spec step 4), so its owner cannot become an
  // administrator.
  const business = await withContext(db, { role: 'system' }, (tx) =>
    findSellerForOwner(tx, user.id),
  )
  if (business) {
    throw new ConflictError(
      'This account owns a seller business, so it cannot become an administrator; use another email address',
    )
  }
  await context.internalAdapter.updateUser(user.id, { role: 'admin' })
  await withContext(db, { role: 'system' }, (tx) =>
    recordAuditEntry(tx, {
      actorUserId: null,
      actorRole: 'system',
      action: 'user.set_role',
      entityType: 'user',
      entityId: user.id,
      after: { role: 'admin' },
    }),
  )
  return 'promoted'
}
