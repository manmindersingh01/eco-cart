import type { Database } from '../../db/client.ts'
import { ForbiddenError } from '../../errors.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import type { JobQueue } from '../../lib/queue.ts'
import { recordAuditEntry } from '../audit/service.ts'
import { queueOtpEmail, queueOtpSms } from '../notifications/service.ts'
import { consumeRateLimit, hashedRateLimitKey } from '../rate-limits/service.ts'
import { findSellerIdForOwner } from '../sellers/service.ts'
import { createAuth, type AccountRole, type Auth } from './auth.ts'
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
 * Turns a signed-in user (or nobody) into the row-level security context for
 * their requests (design doc 6.1 step 5).
 *
 * For example, a seller account owned by Ravi becomes
 * `{ role: 'seller', userId: <Ravi>, sellerId: <Ravi's shop> }`, so every query
 * in his requests can only reach his own products and order lines.
 */
export async function resolveRequestContext(
  db: Database,
  user: { id: string; role?: string | null | undefined } | null,
): Promise<RequestContext> {
  if (!user) return { role: 'anonymous' }
  const role: AccountRole =
    user.role === 'admin' || user.role === 'seller' ? user.role : 'buyer'
  if (role === 'admin') return { role: 'admin', userId: user.id }
  if (role === 'buyer') return { role: 'buyer', userId: user.id }

  // An ordinary signed-in context is enough: the sellers policy lets a user
  // read the seller business they own.
  const sellerId = await withContext(
    db,
    { role: 'buyer', userId: user.id },
    (tx) => findSellerIdForOwner(tx, user.id),
  )
  if (!sellerId) throw new SellerAccountNotReadyError()
  return { role: 'seller', userId: user.id, sellerId }
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
