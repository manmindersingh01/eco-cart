import { randomInt } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Database, Transaction } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { sellers } from '../../db/schema/index.ts'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../errors.ts'
import { uniqueViolation } from '../../lib/postgres.ts'
import { slugify } from '../../lib/slug.ts'
import { parseInput } from '../../lib/validation.ts'
import { explainUniqueViolation, freeSlug, toView } from './service.ts'
import {
  applicationUpdate,
  sellerApplication,
  taxIdIssues,
  type SellerApplication,
  type SellerView,
} from './types.ts'

/*
 * A buyer applies to sell (design doc 5.4, decided 20 October 2026): the
 * application is their own seller business, pending until an administrator
 * approves or rejects it, so the documents, the review, and the approval
 * rules are the same as for a seller an administrator created. The buyer
 * keeps shopping throughout, and once approved the same login also sells.
 *
 * The applicant reads and inserts their business under their own buyer
 * context (the sellers policies let an account read its business and add
 * one pending business of its own). Changes run as that business, the
 * context the seller portal would use, which the update policy allows.
 */

type Buyer = Extract<RequestContext, { role: 'buyer' }>
type SellerRow = typeof sellers.$inferSelect

const INVALID = 'Those application details are not valid'
const NO_APPLICATION = 'You have not applied to sell on EcoKart'

function assertBuyer(context: RequestContext): asserts context is Buyer {
  if (context.role !== 'buyer') {
    throw new ForbiddenError('Sign in with a buyer account to apply to sell')
  }
}

/** The business the account owns, an application or not. */
async function ownBusiness(
  tx: Transaction,
  userId: string,
): Promise<SellerRow | undefined> {
  const [row] = await tx
    .select()
    .from(sellers)
    .where(eq(sellers.ownerUserId, userId))
  return row
}

const asBusiness = (context: Buyer, sellerId: string): RequestContext => ({
  role: 'seller',
  userId: context.userId,
  sellerId,
})

function assertTaxIds(details: Parameters<typeof taxIdIssues>[0]): void {
  const issues = taxIdIssues(details)
  if (issues.length > 0) throw new ValidationError(INVALID, issues)
}

/**
 * An invoice prefix for an applicant who left it out: the initials of the
 * display name and random characters, four in all, such as GB47 for Green
 * Basket. An administrator can change it until the first invoice.
 */
function suggestedPrefix(displayName: string): string {
  const initials = displayName
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let prefix = initials
  while (prefix.length < 4) prefix += characters[randomInt(characters.length)]
  return prefix
}

/**
 * Inserts the application. Pending businesses are not visible to a buyer,
 * so a web address or an invoice prefix may turn out to be taken: each try
 * runs in a savepoint, and a taken one is chosen again.
 */
async function insertApplication(
  tx: Transaction,
  context: Buyer,
  details: SellerApplication,
): Promise<SellerRow> {
  const { invoicePrefix, ...business } = details
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug =
      attempt === 0
        ? await freeSlug(tx, business.displayName)
        : `${slugify(business.displayName, 'seller')}-${randomInt(1000, 10_000)}`
    try {
      const [row] = await tx.transaction((savepoint) =>
        savepoint
          .insert(sellers)
          .values({
            ...business,
            slug,
            invoicePrefix:
              invoicePrefix ?? suggestedPrefix(business.displayName),
            ownerUserId: context.userId,
            status: 'pending',
          })
          .returning(),
      )
      return row!
    } catch (error) {
      const constraint = uniqueViolation(error)
      if (constraint === 'sellers_owner_user_id_unique') {
        throw new ConflictError('You have already applied to sell')
      }
      if (
        constraint === 'sellers_slug_unique' ||
        (constraint === 'sellers_invoice_prefix_unique' && !invoicePrefix)
      ) {
        continue
      }
      throw explainUniqueViolation(error)
    }
  }
  throw new ConflictError(
    'Your application could not be saved this time; try again',
  )
}

/**
 * Applies to sell with the business details: a new pending application, or
 * a rejected one sent again with these details. One application per
 * account.
 */
export async function applyToSell(
  db: Database,
  context: RequestContext,
  input: unknown,
): Promise<SellerView> {
  assertBuyer(context)
  const details = parseInput(sellerApplication, input, INVALID)
  assertTaxIds(details)
  const existing = await withContext(db, context, (tx) =>
    ownBusiness(tx, context.userId),
  )
  if (!existing) {
    return withContext(db, context, async (tx) =>
      toView(await insertApplication(tx, context, details)),
    )
  }
  if (existing.status === 'pending') {
    throw new ConflictError(
      'You have already applied; change your application while it waits for review',
    )
  }
  if (existing.status !== 'rejected') {
    throw new ConflictError('This account already sells on EcoKart')
  }
  const { invoicePrefix, ...business } = details
  try {
    return await withContext(
      db,
      asBusiness(context, existing.id),
      async (tx) => {
        const [row] = await tx
          .update(sellers)
          .set({
            ...business,
            ...(invoicePrefix ? { invoicePrefix } : {}),
            status: 'pending',
            rejectionReason: null,
          })
          .where(eq(sellers.id, existing.id))
          .returning()
        return toView(row!)
      },
    )
  } catch (error) {
    throw explainUniqueViolation(error)
  }
}

/** The account's own application or seller business, or 404. */
export async function getOwnApplication(
  db: Database,
  context: RequestContext,
): Promise<SellerView> {
  if (context.role !== 'buyer' && context.role !== 'seller') {
    throw new ForbiddenError('Sign in with a buyer account to apply to sell')
  }
  const row = await withContext(db, context, (tx) =>
    ownBusiness(tx, context.userId),
  )
  if (!row) throw new NotFoundError(NO_APPLICATION)
  return toView(row)
}

/**
 * Changes the application while it waits for review or after a rejection;
 * a rejected application is sent again with applyToSell.
 */
export async function updateOwnApplication(
  db: Database,
  context: RequestContext,
  input: unknown,
): Promise<SellerView> {
  assertBuyer(context)
  const changes = parseInput(applicationUpdate, input, INVALID)
  if (Object.keys(changes).length === 0) {
    throw new ValidationError('There is nothing to change')
  }
  const existing = await withContext(db, context, (tx) =>
    ownBusiness(tx, context.userId),
  )
  if (!existing) throw new NotFoundError(NO_APPLICATION)
  if (existing.status !== 'pending' && existing.status !== 'rejected') {
    throw new ConflictError(
      'Your application has been decided; contact EcoKart to change your business details',
    )
  }
  assertTaxIds({ ...existing, ...changes })
  try {
    return await withContext(
      db,
      asBusiness(context, existing.id),
      async (tx) => {
        const [row] = await tx
          .update(sellers)
          .set(changes)
          .where(eq(sellers.id, existing.id))
          .returning()
        return toView(row!)
      },
    )
  } catch (error) {
    throw explainUniqueViolation(error)
  }
}
