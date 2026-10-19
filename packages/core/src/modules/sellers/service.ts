import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { Database, Transaction } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { sellerDocumentRequests, sellers } from '../../db/schema/index.ts'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../errors.ts'
import {
  afterCursor,
  exactTime,
  newestFirstCursor,
  pageSize,
  toPage,
  type Page,
} from '../../lib/pagination.ts'
import { uniqueViolation } from '../../lib/postgres.ts'
import { firstFreeSlug, slugify } from '../../lib/slug.ts'
import { isUuid, parseInput } from '../../lib/validation.ts'
import { recordAuditEntry, type AuditEntry } from '../audit/service.ts'
import { invalidateStorefront } from '../catalogue/storefront-cache.ts'
import type { Account, AccountDirectory } from '../auth/accounts.ts'
import {
  businessUpdate,
  contactsUpdate,
  DOCUMENT_TYPES,
  documentTypeName,
  newSeller,
  OPEN_DOCUMENT_STATUSES,
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
export type Administrator = Extract<
  RequestContext,
  { role: 'admin' | 'system' }
>

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

export function assertAdministrator(
  context: RequestContext,
): asserts context is Administrator {
  if (context.role !== 'admin' && context.role !== 'system') {
    throw new ForbiddenError('Only administrators can manage sellers')
  }
}

export const administratorActor = (
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

const OPEN_DOCUMENT_STATES: Record<string, string> = {
  requested: 'waiting for the seller to upload it',
  processing: 'being checked',
  received: 'waiting for review',
}

/**
 * The seller's document requests that are neither accepted nor cancelled,
 * in words, for example "PAN card (waiting for review)". Ordered by type,
 * then oldest first, so the same requests always read the same way.
 */
async function outstandingDocuments(
  tx: Transaction,
  sellerId: string,
): Promise<string[]> {
  const rows = await tx
    .select({
      type: sellerDocumentRequests.documentType,
      status: sellerDocumentRequests.status,
    })
    .from(sellerDocumentRequests)
    .where(
      and(
        eq(sellerDocumentRequests.sellerId, sellerId),
        inArray(sellerDocumentRequests.status, OPEN_DOCUMENT_STATUSES),
      ),
    )
    .orderBy(
      sql`array_position(array[${sql.join(
        DOCUMENT_TYPES.map((type) => sql`${type}`),
        sql`, `,
      )}]::text[], ${sellerDocumentRequests.documentType})`,
      sellerDocumentRequests.createdAt,
      sellerDocumentRequests.id,
    )
  return rows.map(
    ({ type, status }) =>
      `${documentTypeName(type)} (${OPEN_DOCUMENT_STATES[status] ?? status})`,
  )
}

/**
 * pending to approved. Needs a GSTIN and a PAN for the seller's invoices,
 * and every document an administrator asked for accepted or cancelled.
 */
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
    // Asking for a document locks the seller row too, so a request made at
    // the same moment is either seen here or made after the approval.
    const outstanding = await outstandingDocuments(tx, sellerId)
    if (outstanding.length > 0) {
      throw new ConflictError(
        `This seller cannot be approved until every requested document is accepted or cancelled. Still open: ${outstanding.join(', ')}`,
      )
    }
    const [row] = await tx
      .update(sellers)
      .set({ status: 'approved', approvedAt: sql`now()` })
      .where(eq(sellers.id, sellerId))
      .returning()
    // Their approved products appear on the storefront.
    await invalidateStorefront(tx, 'everything')
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
    // Their products disappear from every storefront page.
    await invalidateStorefront(tx, 'everything')
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
    await invalidateStorefront(tx, 'everything')
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
      // Also while suspended: reinstating brings the seller back as approved,
      // and every sale needs a GST invoice with these details.
      if (current.approvedAt) {
        if (!merged.gstin)
          issues.push('gstin is needed once the seller has been approved')
        if (!merged.pan)
          issues.push('pan is needed once the seller has been approved')
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
      // Product pages show the seller's display name.
      if (
        changes.displayName !== undefined &&
        changes.displayName !== current.displayName
      ) {
        await invalidateStorefront(tx, { sellerId })
      }
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

export function assertSeller(
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
    if (
      changes.displayName !== undefined &&
      changes.displayName !== current.displayName
    ) {
      await invalidateStorefront(tx, { sellerId: context.sellerId })
    }
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
    newestFirstCursor,
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

/** A seller as lists in other modules show it, for example the review queue. */
export interface SellerLabel {
  id: string
  displayName: string
  status: SellerStatus
}

/**
 * The name and status of each seller in `ids`, so other modules can show
 * sellers without reading this module's table (backend spec step 7).
 */
export async function getSellerLabels(
  tx: Transaction,
  ids: string[],
): Promise<Map<string, SellerLabel>> {
  if (ids.length === 0) return new Map()
  const rows = await tx
    .select({
      id: sellers.id,
      displayName: sellers.displayName,
      status: sellers.status,
    })
    .from(sellers)
    .where(inArray(sellers.id, [...new Set(ids)]))
  return new Map(
    rows.map((row) => {
      if (!isStatus(row.status)) {
        throw new Error(`Seller ${row.id} has an unknown status ${row.status}`)
      }
      return [row.id, { ...row, status: row.status }]
    }),
  )
}

// Invoice numbers (backend spec step 14). The sellers module owns each
// seller's sequence; the invoices module turns it into an invoice number.

/** The seller's details as their invoice prints them, read under the lock. */
export interface InvoicingSeller {
  id: string
  legalName: string
  displayName: string
  gstin: string | null
  line1: string
  city: string
  stateCode: string
  pincode: string
  supportEmail: string
  supportPhone: string
  invoicePrefix: string
}

/**
 * Takes the seller's next invoice sequence number in `financialYear` (like
 * `2026-27`): one more than the last, or 1 for the first invoice of a new
 * year. One conditional UPDATE: its row lock makes two confirmations for the
 * same seller take turns, and a transaction that rolls back gives its number
 * back, so numbers never repeat and never leave a gap.
 *
 * The sequence never returns to 0, which the rule against changing the
 * invoice prefix after the first invoice relies on, and never moves back to
 * an earlier year.
 */
export async function takeInvoiceNumber(
  tx: Transaction,
  sellerId: string,
  financialYear: string,
): Promise<{ sequence: number; seller: InvoicingSeller }> {
  const [row] = await tx
    .update(sellers)
    .set({
      // Both expressions read the row as it was before this UPDATE.
      invoiceSeq: sql`case when ${sellers.invoiceSeqFy} = ${financialYear} then ${sellers.invoiceSeq} + 1 else 1 end`,
      invoiceSeqFy: financialYear,
    })
    .where(
      and(
        eq(sellers.id, sellerId),
        // Year strings like 2026-27 sort in time order.
        or(
          isNull(sellers.invoiceSeqFy),
          lte(sellers.invoiceSeqFy, financialYear),
        ),
      ),
    )
    .returning({
      sequence: sellers.invoiceSeq,
      id: sellers.id,
      legalName: sellers.legalName,
      displayName: sellers.displayName,
      gstin: sellers.gstin,
      line1: sellers.line1,
      city: sellers.city,
      stateCode: sellers.stateCode,
      pincode: sellers.pincode,
      supportEmail: sellers.supportEmail,
      supportPhone: sellers.supportPhone,
      invoicePrefix: sellers.invoicePrefix,
    })
  if (row) {
    const { sequence, ...seller } = row
    return { sequence, seller }
  }

  const [exists] = await tx
    .select({ year: sellers.invoiceSeqFy })
    .from(sellers)
    .where(eq(sellers.id, sellerId))
  if (!exists) throw new Error(`There is no seller ${sellerId}`)
  // Only possible within a second of midnight on 31 March: a confirmation
  // that started in the old year reached the sequence after one in the new.
  throw new ConflictError(
    `Invoice numbers have moved on to ${exists.year}; try again`,
  )
}

/* What the storefront shows of sellers (backend spec step 9). */

/** A seller as visitors see them. */
export interface PublicSeller {
  id: string
  slug: string
  displayName: string
}

/** The approved sellers among `sellerIds`, by id; the others are left out. */
export async function getPublicSellers(
  tx: Transaction,
  sellerIds: readonly string[],
): Promise<Map<string, PublicSeller>> {
  if (sellerIds.length === 0) return new Map()
  const rows = await tx
    .select({
      id: sellers.id,
      slug: sellers.slug,
      displayName: sellers.displayName,
    })
    .from(sellers)
    .where(
      and(inArray(sellers.id, [...sellerIds]), eq(sellers.status, 'approved')),
    )
  return new Map(rows.map((row) => [row.id, row]))
}

/**
 * A condition that the seller in `sellerId`, a column of another table, is
 * approved. Storefront queries check it in their own SQL; row-level security
 * repeats it only as a safety net.
 */
export const sellerIsApproved = (sellerId: AnyPgColumn): SQL =>
  sql`exists (select 1 from ${sellers} where ${sellers.id} = ${sellerId} and ${sellers.status} = 'approved')`

/* Checkout (backend spec step 12). */

/**
 * Each seller's own commission rate in basis points, or null where the
 * platform rate applies, so checkout can freeze the rate on each order line
 * without reading this module's table.
 */
export async function getCommissionRates(
  tx: Transaction,
  ids: string[],
): Promise<Map<string, number | null>> {
  if (ids.length === 0) return new Map()
  const rows = await tx
    .select({ id: sellers.id, commissionBps: sellers.commissionBps })
    .from(sellers)
    .where(inArray(sellers.id, [...new Set(ids)]))
  return new Map(rows.map((row) => [row.id, row.commissionBps]))
}

/* Orders (backend spec step 13). */

/**
 * The display names of the sellers among `ids` that the caller may see, by
 * id: every seller for administrators, approved ones for buyers, so a
 * suspended seller's lines show without a name.
 */
export async function getSellerNames(
  tx: Transaction,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const rows = await tx
    .select({ id: sellers.id, displayName: sellers.displayName })
    .from(sellers)
    .where(inArray(sellers.id, [...new Set(ids)]))
  return new Map(rows.map((row) => [row.id, row.displayName]))
}
