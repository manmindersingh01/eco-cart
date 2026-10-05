import { desc, eq, sql } from 'drizzle-orm'
import type { Database, Transaction } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { sellers } from '../../db/schema/index.ts'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../errors.ts'
import {
  afterCursor,
  exactTime,
  pageSize,
  toPage,
  type Page,
} from '../../lib/pagination.ts'
import { uniqueViolation } from '../../lib/postgres.ts'
import { firstFreeSlug, slugify } from '../../lib/slug.ts'
import { isUuid, parseInput } from '../../lib/validation.ts'
import { recordAuditEntry, type AuditEntry } from '../audit/service.ts'
import type { Account, AccountDirectory } from '../auth/accounts.ts'
import {
  businessUpdate,
  contactsUpdate,
  newSeller,
  suspension,
  taxIdIssues,
  type SellerStatus,
  type SellerView,
} from './types.ts'

/*
 * The seller lifecycle (backend spec step 4, design doc 5.3 and 5.4):
 * created as pending, approved, suspended, and reinstated by administrators.
 *
 * Creating, suspending, and reinstating also change the owner's Better Auth
 * account, which Better Auth saves in its own database calls. These functions
 * therefore take the database and run their own transactions, ordered so a
 * failure never leaves a seller account without a business, or a suspended
 * seller able to act.
 */

export interface SellerServices {
  /** Connected as ecokart_web. */
  db: Database
  accounts: AccountDirectory
}

type SellerRow = typeof sellers.$inferSelect
type Administrator = Extract<RequestContext, { role: 'admin' | 'system' }>

const STATUSES: readonly SellerStatus[] = ['pending', 'approved', 'suspended']
const isStatus = (value: string): value is SellerStatus =>
  STATUSES.some((status) => status === value)

function toView(row: SellerRow): SellerView {
  if (!isStatus(row.status)) {
    throw new Error(`Seller ${row.id} has an unknown status ${row.status}`)
  }
  return {
    id: row.id,
    slug: row.slug,
    ownerUserId: row.ownerUserId,
    status: row.status,
    displayName: row.displayName,
    legalName: row.legalName,
    gstin: row.gstin,
    pan: row.pan,
    line1: row.line1,
    city: row.city,
    stateCode: row.stateCode,
    pincode: row.pincode,
    supportEmail: row.supportEmail,
    supportPhone: row.supportPhone,
    invoicePrefix: row.invoicePrefix,
    commissionBps: row.commissionBps,
    approvedAt: row.approvedAt,
    suspendedReason: row.suspendedReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** The business details as an audit entry records them. */
function auditable(view: SellerView) {
  const { createdAt: _created, updatedAt: _updated, ...details } = view
  return details
}

function assertAdministrator(
  context: RequestContext,
): asserts context is Administrator {
  if (context.role !== 'admin' && context.role !== 'system') {
    throw new ForbiddenError('Only administrators can manage sellers')
  }
}

const administratorActor = (
  context: Administrator,
): Pick<AuditEntry, 'actorUserId' | 'actorRole'> => ({
  actorUserId: context.userId ?? null,
  actorRole: context.role,
})

/** Locks one seller for a change, or 404. */
async function lockSeller(tx: Transaction, id: string): Promise<SellerRow> {
  if (!isUuid(id)) throw new NotFoundError('There is no seller with that id')
  const [row] = await tx
    .select()
    .from(sellers)
    .where(eq(sellers.id, id))
    .for('update')
  if (!row) throw new NotFoundError('There is no seller with that id')
  return row
}

/** Turns a unique-constraint race into the message the pre-check gives. */
function explainUniqueViolation(error: unknown): unknown {
  const constraint = uniqueViolation(error)
  if (constraint === 'sellers_invoice_prefix_unique') {
    return new ValidationError('Those seller details are not valid', [
      'invoicePrefix is already used by another seller',
    ])
  }
  if (constraint === 'sellers_slug_unique') {
    return new ConflictError(
      'Another seller with the same name was created at the same moment; try again',
    )
  }
  return error
}

async function freeSlug(tx: Transaction, displayName: string): Promise<string> {
  const base = slugify(displayName, 'seller')
  // A slug holds only a-z, 0-9, and hyphens, so it is safe inside the pattern.
  const taken = await tx
    .select({ slug: sellers.slug })
    .from(sellers)
    .where(sql`${sellers.slug} ~ ${`^${base}(-[0-9]+)?$`}`)
  return firstFreeSlug(
    base,
    taken.map((row) => row.slug),
  )
}

async function assertInvoicePrefixFree(
  tx: Transaction,
  prefix: string,
  exceptSellerId?: string,
): Promise<void> {
  const [owner] = await tx
    .select({ id: sellers.id })
    .from(sellers)
    .where(eq(sellers.invoicePrefix, prefix))
  if (owner && owner.id !== exceptSellerId) {
    throw new ValidationError('Those seller details are not valid', [
      'invoicePrefix is already used by another seller',
    ])
  }
}

/**
 * Creates a seller business and its owner's sign-in account (role `seller`),
 * with the business `pending` until an administrator approves it.
 */
export async function createSeller(
  { db, accounts }: SellerServices,
  context: RequestContext,
  input: unknown,
): Promise<SellerView> {
  assertAdministrator(context)
  const { owner, ...details } = parseInput(
    newSeller,
    input,
    'Those seller details are not valid',
  )
  const crossField = taxIdIssues(details)
  if (crossField.length > 0) {
    throw new ValidationError('Those seller details are not valid', crossField)
  }
  const email = owner.email.trim().toLowerCase()
  if (await accounts.findByEmail(email)) {
    throw new ValidationError('Those seller details are not valid', [
      'owner.email already has an account; a seller needs an email address of its own',
    ])
  }
  await withContext(db, context, (tx) =>
    assertInvoicePrefixFree(tx, details.invoicePrefix),
  )

  let account: Account
  try {
    account = await accounts.createSellerOwner({
      email,
      name: owner.name,
      phoneNumber: owner.phoneNumber,
    })
  } catch (error) {
    if (uniqueViolation(error)?.includes('phone_number')) {
      throw new ValidationError('Those seller details are not valid', [
        'owner.phoneNumber already belongs to another account',
      ])
    }
    throw error
  }

  try {
    return await withContext(db, context, async (tx) => {
      const [row] = await tx
        .insert(sellers)
        .values({
          ...details,
          slug: await freeSlug(tx, details.displayName),
          ownerUserId: account.id,
          status: 'pending',
        })
        .returning()
      const view = toView(row!)
      await recordAuditEntry(tx, {
        ...administratorActor(context),
        action: 'seller.create',
        entityType: 'seller',
        entityId: view.id,
        after: { ...auditable(view), ownerEmail: email },
      })
      return view
    })
  } catch (error) {
    // Never leave a seller account without its business.
    await accounts.remove(account.id)
    throw explainUniqueViolation(error)
  }
}

/** pending to approved. Needs a GSTIN and a PAN for the seller's invoices. */
export async function approveSeller(
  db: Database,
  context: RequestContext,
  sellerId: string,
): Promise<SellerView> {
  assertAdministrator(context)
  return withContext(db, context, async (tx) => {
    const current = await lockSeller(tx, sellerId)
    if (current.status === 'approved') return toView(current)
    if (current.status === 'suspended') {
      throw new ConflictError('A suspended seller is reinstated, not approved')
    }
    const missing = [
      ...(current.gstin ? [] : ['gstin is needed before approval']),
      ...(current.pan ? [] : ['pan is needed before approval']),
    ]
    if (missing.length > 0) {
      throw new ValidationError('This seller cannot be approved yet', missing)
    }
    const [row] = await tx
      .update(sellers)
      .set({ status: 'approved', approvedAt: sql`now()` })
      .where(eq(sellers.id, sellerId))
      .returning()
    await recordAuditEntry(tx, {
      ...administratorActor(context),
      action: 'seller.approve',
      entityType: 'seller',
      entityId: sellerId,
      before: { status: current.status },
      after: { status: 'approved' },
    })
    return toView(row!)
  })
}

/**
 * Suspends a seller with a reason, then bans the owner's account, which ends
 * their sessions. The business is suspended first: if the ban then failed,
 * the request context would still refuse the seller.
 */
export async function suspendSeller(
  { db, accounts }: SellerServices,
  context: RequestContext,
  sellerId: string,
  input: unknown,
): Promise<SellerView> {
  assertAdministrator(context)
  const { reason } = parseInput(
    suspension,
    input,
    'A reason is needed to suspend a seller',
  )
  const view = await withContext(db, context, async (tx) => {
    const current = await lockSeller(tx, sellerId)
    if (current.status === 'suspended') return toView(current)
    const [row] = await tx
      .update(sellers)
      .set({ status: 'suspended', suspendedReason: reason })
      .where(eq(sellers.id, sellerId))
      .returning()
    await recordAuditEntry(tx, {
      ...administratorActor(context),
      action: 'seller.suspend',
      entityType: 'seller',
      entityId: sellerId,
      before: { status: current.status },
      after: { status: 'suspended', reason },
    })
    return toView(row!)
  })
  await accounts.ban(view.ownerUserId, `Seller suspended: ${reason}`)
  return view
}

/**
 * Lifts a suspension: back to approved, or to pending for a seller who was
 * never approved. Then lifts the ban on the owner's account.
 */
export async function reinstateSeller(
  { db, accounts }: SellerServices,
  context: RequestContext,
  sellerId: string,
): Promise<SellerView> {
  assertAdministrator(context)
  const view = await withContext(db, context, async (tx) => {
    const current = await lockSeller(tx, sellerId)
    if (current.status !== 'suspended') return toView(current)
    const next: SellerStatus = current.approvedAt ? 'approved' : 'pending'
    const [row] = await tx
      .update(sellers)
      .set({ status: next, suspendedReason: null })
      .where(eq(sellers.id, sellerId))
      .returning()
    await recordAuditEntry(tx, {
      ...administratorActor(context),
      action: 'seller.reinstate',
      entityType: 'seller',
      entityId: sellerId,
      before: { status: 'suspended', reason: current.suspendedReason },
      after: { status: next },
    })
    return toView(row!)
  })
  // Also repairs a ban that outlived an earlier reinstatement.
  await accounts.unban(view.ownerUserId)
  return view
}

/** An administrator edits business details. */
export async function updateSeller(
  db: Database,
  context: RequestContext,
  sellerId: string,
  input: unknown,
): Promise<SellerView> {
  assertAdministrator(context)
  const changes = parseInput(
    businessUpdate,
    input,
    'Those seller details are not valid',
  )
  if (Object.keys(changes).length === 0) {
    throw new ValidationError('There is nothing to change')
  }
  try {
    return await withContext(db, context, async (tx) => {
      const current = await lockSeller(tx, sellerId)
      const merged = { ...current, ...changes }
      const issues = taxIdIssues(merged)
      if (current.status === 'approved') {
        if (!merged.gstin)
          issues.push('gstin is needed while the seller is approved')
        if (!merged.pan)
          issues.push('pan is needed while the seller is approved')
      }
      if (issues.length > 0) {
        throw new ValidationError('Those seller details are not valid', issues)
      }
      if (
        changes.invoicePrefix !== undefined &&
        changes.invoicePrefix !== current.invoicePrefix
      ) {
        if (current.invoiceSeq > 0) {
          throw new ConflictError(
            'The invoice prefix cannot change after the first invoice',
          )
        }
        await assertInvoicePrefixFree(tx, changes.invoicePrefix, sellerId)
      }
      const [row] = await tx
        .update(sellers)
        .set(changes)
        .where(eq(sellers.id, sellerId))
        .returning()
      const before = auditable(toView(current))
      await recordAuditEntry(tx, {
        ...administratorActor(context),
        action: 'seller.update',
        entityType: 'seller',
        entityId: sellerId,
        // Only the fields this change touched.
        before: Object.fromEntries(
          Object.entries(before).filter(([key]) => key in changes),
        ),
        after: changes,
      })
      return toView(row!)
    })
  } catch (error) {
    throw explainUniqueViolation(error)
  }
}

function assertSeller(
  context: RequestContext,
): asserts context is Extract<RequestContext, { role: 'seller' }> {
  if (context.role !== 'seller') {
    throw new ForbiddenError('This needs a seller account')
  }
}

/** The seller's own business details. */
export async function getOwnSeller(
  db: Database,
  context: RequestContext,
): Promise<SellerView> {
  assertSeller(context)
  return withContext(db, context, async (tx) => {
    const [row] = await tx
      .select()
      .from(sellers)
      .where(eq(sellers.id, context.sellerId))
    if (!row) throw new NotFoundError('There is no seller with that id')
    return toView(row)
  })
}

/** A seller changes their display name and support contacts. */
export async function updateOwnContacts(
  db: Database,
  context: RequestContext,
  input: unknown,
): Promise<SellerView> {
  assertSeller(context)
  const changes = parseInput(
    contactsUpdate,
    input,
    'Those contact details are not valid',
  )
  if (Object.keys(changes).length === 0) {
    throw new ValidationError('There is nothing to change')
  }
  return withContext(db, context, async (tx) => {
    const current = await lockSeller(tx, context.sellerId)
    const [row] = await tx
      .update(sellers)
      .set(changes)
      .where(eq(sellers.id, context.sellerId))
      .returning()
    await recordAuditEntry(tx, {
      actorUserId: context.userId,
      actorRole: 'seller',
      action: 'seller.update_contacts',
      entityType: 'seller',
      entityId: context.sellerId,
      before: {
        displayName: current.displayName,
        supportEmail: current.supportEmail,
        supportPhone: current.supportPhone,
      },
      after: changes,
    })
    return toView(row!)
  })
}

export interface SellerDetail extends SellerView {
  owner: Pick<
    Account,
    'email' | 'name' | 'phoneNumber' | 'banned' | 'banReason'
  > | null
}

/** One seller with its owner's account, for administrators. */
export async function getSeller(
  { db, accounts }: SellerServices,
  context: RequestContext,
  sellerId: string,
): Promise<SellerDetail> {
  assertAdministrator(context)
  if (!isUuid(sellerId))
    throw new NotFoundError('There is no seller with that id')
  const [row] = await withContext(db, context, (tx) =>
    tx.select().from(sellers).where(eq(sellers.id, sellerId)),
  )
  if (!row) throw new NotFoundError('There is no seller with that id')
  const account = await accounts.findById(row.ownerUserId)
  return {
    ...toView(row),
    owner: account
      ? {
          email: account.email,
          name: account.name,
          phoneNumber: account.phoneNumber,
          banned: account.banned,
          banReason: account.banReason,
        }
      : null,
  }
}

export interface SellerSummary {
  id: string
  slug: string
  displayName: string
  legalName: string
  status: SellerStatus
  city: string
  stateCode: string
  createdAt: Date
}

/** Sellers newest first, optionally by status, a page at a time. */
export async function listSellers(
  db: Database,
  context: RequestContext,
  options: { status?: string; cursor?: string; limit?: number } = {},
): Promise<Page<SellerSummary>> {
  assertAdministrator(context)
  const { status } = options
  if (status !== undefined && !isStatus(status)) {
    throw new ValidationError('status must be pending, approved, or suspended')
  }
  const limit = pageSize(options.limit)
  const rows = await withContext(db, context, (tx) =>
    tx
      .select({
        id: sellers.id,
        slug: sellers.slug,
        displayName: sellers.displayName,
        legalName: sellers.legalName,
        status: sellers.status,
        city: sellers.city,
        stateCode: sellers.stateCode,
        createdAt: sellers.createdAt,
        cursorTime: exactTime(sellers.createdAt),
      })
      .from(sellers)
      .where(
        sql.join(
          [
            status ? sql`${sellers.status} = ${status}` : sql`true`,
            options.cursor
              ? afterCursor(options.cursor, sellers.createdAt, sellers.id)
              : sql`true`,
          ],
          sql` and `,
        ),
      )
      .orderBy(desc(sellers.createdAt), desc(sellers.id))
      .limit(limit + 1),
  )
  return toPage(
    rows,
    limit,
    ({ cursorTime: _cursor, status: rowStatus, ...row }) => {
      if (!isStatus(rowStatus)) {
        throw new Error(`Seller ${row.id} has an unknown status ${rowStatus}`)
      }
      return { ...row, status: rowStatus }
    },
  )
}

/**
 * The seller business an account owns, with its status, or null. Used to
 * build the request context and by the role guard on Better Auth's endpoints.
 */
export async function findSellerForOwner(
  tx: Transaction,
  ownerUserId: string,
): Promise<{ id: string; status: SellerStatus } | null> {
  const [row] = await tx
    .select({ id: sellers.id, status: sellers.status })
    .from(sellers)
    .where(eq(sellers.ownerUserId, ownerUserId))
  if (!row) return null
  if (!isStatus(row.status)) {
    throw new Error(`Seller ${row.id} has an unknown status ${row.status}`)
  }
  return { id: row.id, status: row.status }
}
