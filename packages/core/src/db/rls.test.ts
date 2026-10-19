import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { requireEnv } from '../env.ts'
import {
  createTestCategory,
  createTestOrder,
  createTestProduct,
  createTestSeller,
  createTestUser,
} from '../testing/fixtures.ts'
import { createDatabase, type Database } from './client.ts'
import { withContext, type RequestContext } from './context.ts'
import { createPool, type DatabasePool } from './pool.ts'
import {
  addresses,
  cartItems,
  carts,
  emailOutbox,
  invoices,
  orderItems,
  orders,
  paymentEvents,
  productModeration,
  productVariants,
  products,
  returnPhotos,
  returnRequests,
  sellerBankAccounts,
  sellerDocumentFiles,
  sellerDocumentRequests,
  sellerLedgerEntries,
  sellers,
  settlementStatements,
} from './schema/index.ts'

/*
 * Launch-critical: proves the database itself keeps buyers, sellers, and
 * guests apart (backend spec step 1, design doc section 8). Fixtures are
 * written as the owner; every assertion reads as ecokart_web or
 * ecokart_worker, exactly as the running programs do.
 */

const pools: DatabasePool[] = []
function connect(url: string, name: string): Database {
  const pool = createPool(url, name)
  pools.push(pool)
  return createDatabase(pool)
}

const owner = connect(requireEnv('MIGRATION_DATABASE_URL'), 'rls-test-owner')
const web = connect(requireEnv('DATABASE_URL'), 'rls-test-web')
const worker = connect(requireEnv('WORKER_DATABASE_URL'), 'rls-test-worker')

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()))
})

/** The PostgreSQL error code, looking through Drizzle's wrapping error. */
function postgresCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const fromCause = 'cause' in error ? postgresCode(error.cause) : undefined
  if (fromCause !== undefined) return fromCause
  return 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return postgresCode(error) ?? 'unknown'
  }
  throw new Error('Expected the query to fail')
}

const INSUFFICIENT_PRIVILEGE = '42501'
const RESTRICT_VIOLATION = '23001'
const UNIQUE_VIOLATION = '23505'
const CHECK_VIOLATION = '23514'

// Two sellers, two buyers, an administrator, and data that belongs to each.
let sellerA: Awaited<ReturnType<typeof createTestSeller>>
let sellerB: Awaited<ReturnType<typeof createTestSeller>>
let buyer1: Awaited<ReturnType<typeof createTestUser>>
let buyer2: Awaited<ReturnType<typeof createTestUser>>
let admin: Awaited<ReturnType<typeof createTestUser>>
let approvedA: Awaited<ReturnType<typeof createTestProduct>>
let approvedB: Awaited<ReturnType<typeof createTestProduct>>
let draftA: Awaited<ReturnType<typeof createTestProduct>>
let draftB: Awaited<ReturnType<typeof createTestProduct>>
let order1: Awaited<ReturnType<typeof createTestOrder>>
let order2: Awaited<ReturnType<typeof createTestOrder>>
let productIds: string[]
let address1Id: string
let address2Id: string
let guestCartId: string
const guestToken = `guest-${crypto.randomUUID()}`

const as = {
  anonymous: (): RequestContext => ({ role: 'anonymous' }),
  guest: (token: string): RequestContext => ({
    role: 'anonymous',
    guestToken: token,
  }),
  buyer: (user: { id: string }): RequestContext => ({
    role: 'buyer',
    userId: user.id,
  }),
  seller: (s: typeof sellerA): RequestContext => ({
    role: 'seller',
    userId: s.owner.id,
    sellerId: s.seller.id,
  }),
  admin: (): RequestContext => ({ role: 'admin', userId: admin.id }),
}

beforeAll(async () => {
  sellerA = await createTestSeller(owner)
  sellerB = await createTestSeller(owner)
  buyer1 = await createTestUser(owner, 'buyer')
  buyer2 = await createTestUser(owner, 'buyer')
  admin = await createTestUser(owner, 'admin')
  const category = await createTestCategory(owner)
  const productOf = (
    s: typeof sellerA,
    status: 'approved' | 'draft' = 'approved',
  ) =>
    createTestProduct(owner, {
      sellerId: s.seller.id,
      categoryId: category.id,
      status,
    })
  approvedA = await productOf(sellerA)
  approvedB = await productOf(sellerB)
  draftA = await productOf(sellerA, 'draft')
  draftB = await productOf(sellerB, 'draft')
  productIds = [approvedA, approvedB, draftA, draftB].map((p) => p.product.id)

  const lineFor = (s: typeof sellerA, p: typeof approvedA) => ({
    sellerId: s.seller.id,
    productId: p.product.id,
    variantId: p.variant.id,
  })
  // order1 holds one item from each seller; order2 only seller B's.
  order1 = await createTestOrder(owner, {
    buyerId: buyer1.id,
    lines: [lineFor(sellerA, approvedA), lineFor(sellerB, approvedB)],
  })
  order2 = await createTestOrder(owner, {
    buyerId: buyer2.id,
    lines: [lineFor(sellerB, approvedB)],
  })

  const [address1, address2] = await owner
    .insert(addresses)
    .values([addressFor(buyer1.id), addressFor(buyer2.id)])
    .returning()
  address1Id = address1!.id
  address2Id = address2!.id

  const [guestCart] = await owner
    .insert(carts)
    .values({ guestToken })
    .returning()
  guestCartId = guestCart!.id
  await owner.insert(cartItems).values({
    cartId: guestCartId,
    variantId: approvedA.variant.id,
    quantity: 1,
  })

  await owner.insert(sellerLedgerEntries).values({
    sellerId: sellerA.seller.id,
    orderId: order1.order.id,
    entryType: 'sale',
    amountPaise: 50_000,
    description: 'Sale of Bamboo bottle',
  })
})

const addressFor = (userId: string) => ({
  userId,
  fullName: 'Asha Patil',
  phone: '+919800000001',
  line1: '4 FC Road',
  city: 'Pune',
  stateCode: '27',
  pincode: '411004',
})

const visibleProductIds = (context: RequestContext) =>
  withContext(web, context, async (tx) =>
    (
      await tx
        .select({ id: products.id })
        .from(products)
        .where(inArray(products.id, productIds))
    ).map((row) => row.id),
  )

const guestCartRows = (context: RequestContext) =>
  withContext(web, context, async (tx) => ({
    carts: (
      await tx
        .select({ id: carts.id })
        .from(carts)
        .where(eq(carts.id, guestCartId))
    ).length,
    items: (
      await tx
        .select({ id: cartItems.id })
        .from(cartItems)
        .where(eq(cartItems.cartId, guestCartId))
    ).length,
  }))

const visibleOrders = (context: RequestContext) =>
  withContext(web, context, async (tx) => {
    const orderRows = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(inArray(orders.id, [order1.order.id, order2.order.id]))
    const itemRows = await tx
      .select({ id: orderItems.id })
      .from(orderItems)
      .where(inArray(orderItems.orderId, [order1.order.id, order2.order.id]))
    return {
      orders: new Set(orderRows.map((row) => row.id)),
      items: new Set(itemRows.map((row) => row.id)),
    }
  })

const ledgerRows = (context: RequestContext) =>
  withContext(web, context, (tx) =>
    tx
      .select({ sellerId: sellerLedgerEntries.sellerId })
      .from(sellerLedgerEntries)
      .where(eq(sellerLedgerEntries.orderId, order1.order.id)),
  )

describe('catalogue', () => {
  test('anonymous visitors see approved products only', async () => {
    expect(new Set(await visibleProductIds(as.anonymous()))).toEqual(
      new Set([approvedA.product.id, approvedB.product.id]),
    )
  })

  test('variants follow the visibility of their product', async () => {
    const variantIds = await withContext(web, as.anonymous(), async (tx) =>
      (
        await tx
          .select({ id: productVariants.id })
          .from(productVariants)
          .where(
            inArray(productVariants.id, [
              approvedA.variant.id,
              draftA.variant.id,
            ]),
          )
      ).map((row) => row.id),
    )
    expect(variantIds).toEqual([approvedA.variant.id])
  })

  test('a seller sees their own drafts but not another seller’s', async () => {
    expect(new Set(await visibleProductIds(as.seller(sellerA)))).toEqual(
      new Set([approvedA.product.id, approvedB.product.id, draftA.product.id]),
    )
  })

  test('a seller cannot change another seller’s product', async () => {
    const changed = await withContext(web, as.seller(sellerA), (tx) =>
      tx
        .update(products)
        .set({ title: 'Taken over' })
        .where(eq(products.id, approvedB.product.id))
        .returning({ id: products.id }),
    )
    expect(changed).toEqual([])

    const changedVariant = await withContext(web, as.seller(sellerA), (tx) =>
      tx
        .update(productVariants)
        .set({ stock: 0 })
        .where(eq(productVariants.id, approvedB.variant.id))
        .returning({ id: productVariants.id }),
    )
    expect(changedVariant).toEqual([])
  })

  test('a seller cannot list a product under another seller', async () => {
    const code = await errorCode(
      withContext(web, as.seller(sellerA), (tx) =>
        tx.insert(products).values({
          sellerId: sellerB.seller.id,
          categoryId: approvedA.product.categoryId,
          title: 'Fake listing',
          slug: `fake-${crypto.randomUUID()}`,
        }),
      ),
    )
    expect(code).toBe(INSUFFICIENT_PRIVILEGE)
  })

  test('a seller can edit their own product', async () => {
    const changed = await withContext(web, as.seller(sellerA), (tx) =>
      tx
        .update(products)
        .set({ description: 'Leak-proof bamboo bottle' })
        .where(eq(products.id, draftA.product.id))
        .returning({ id: products.id }),
    )
    expect(changed).toEqual([{ id: draftA.product.id }])
  })

  // A buyer may add only their own pending application (design doc 5.4);
  // an approved seller, or one for someone else, needs full access.
  test('a buyer cannot create an approved seller or one for someone else', async () => {
    const business = (ownerUserId: string, status: 'pending' | 'approved') =>
      withContext(web, as.buyer(buyer1), (tx) =>
        tx.insert(sellers).values({
          ownerUserId,
          slug: `self-made-${crypto.randomUUID()}`,
          displayName: 'Self made',
          legalName: 'Self made',
          line1: '1 Main Road',
          city: 'Pune',
          stateCode: '27',
          pincode: '411001',
          supportEmail: 'self@example.test',
          supportPhone: '+919800000009',
          invoicePrefix: 'SELF',
          status,
          approvedAt: status === 'approved' ? new Date() : null,
        }),
      )
    expect(await errorCode(business(buyer1.id, 'approved'))).toBe(
      INSUFFICIENT_PRIVILEGE,
    )
    expect(await errorCode(business(buyer2.id, 'pending'))).toBe(
      INSUFFICIENT_PRIVILEGE,
    )
  })
})

describe('buyer data', () => {
  test('a buyer sees only their own addresses', async () => {
    const ids = await withContext(web, as.buyer(buyer1), async (tx) =>
      (
        await tx
          .select({ id: addresses.id })
          .from(addresses)
          .where(inArray(addresses.id, [address1Id, address2Id]))
      ).map((row) => row.id),
    )
    expect(ids).toEqual([address1Id])
  })

  test('a buyer cannot save an address for someone else', async () => {
    const code = await errorCode(
      withContext(web, as.buyer(buyer1), (tx) =>
        tx.insert(addresses).values({
          userId: buyer2.id,
          fullName: 'Not me',
          phone: '+919800000002',
          line1: '1 Main Road',
          city: 'Pune',
          stateCode: '27',
          pincode: '411001',
        }),
      ),
    )
    expect(code).toBe(INSUFFICIENT_PRIVILEGE)
  })

  test('a guest reaches their cart only with its token', async () => {
    expect(await guestCartRows(as.guest(guestToken))).toEqual({
      carts: 1,
      items: 1,
    })
    expect(await guestCartRows(as.guest('someone-elses-token'))).toEqual({
      carts: 0,
      items: 0,
    })
    expect(await guestCartRows(as.anonymous())).toEqual({ carts: 0, items: 0 })
  })
})

describe('orders', () => {
  test('a buyer sees their own order with every line', async () => {
    expect(await visibleOrders(as.buyer(buyer1))).toEqual({
      orders: new Set([order1.order.id]),
      items: new Set(order1.items.map((item) => item.id)),
    })
  })

  test('a seller sees orders they sell into, but only their own lines', async () => {
    const sellerALine = order1.items.find(
      (item) => item.sellerId === sellerA.seller.id,
    )!
    expect(await visibleOrders(as.seller(sellerA))).toEqual({
      orders: new Set([order1.order.id]),
      items: new Set([sellerALine.id]),
    })
  })

  test('an administrator sees every order and line', async () => {
    expect(await visibleOrders(as.admin())).toEqual({
      orders: new Set([order1.order.id, order2.order.id]),
      items: new Set([...order1.items, ...order2.items].map((item) => item.id)),
    })
  })

  test('anonymous visitors see no orders', async () => {
    expect(await visibleOrders(as.anonymous())).toEqual({
      orders: new Set(),
      items: new Set(),
    })
  })
})

describe('seller ledger', () => {
  test('a seller sees only their own entries', async () => {
    expect(await ledgerRows(as.seller(sellerA))).toEqual([
      { sellerId: sellerA.seller.id },
    ])
    expect(await ledgerRows(as.seller(sellerB))).toEqual([])
  })

  test('the web app cannot change an entry, even as an administrator', async () => {
    const code = await errorCode(
      withContext(web, as.admin(), (tx) =>
        tx
          .update(sellerLedgerEntries)
          .set({ amountPaise: 1 })
          .where(eq(sellerLedgerEntries.sellerId, sellerA.seller.id)),
      ),
    )
    expect(code).toBe(INSUFFICIENT_PRIVILEGE)
  })

  test('not even the database owner can change or delete an entry', async () => {
    expect(
      await errorCode(
        owner
          .update(sellerLedgerEntries)
          .set({ amountPaise: 1 })
          .where(eq(sellerLedgerEntries.sellerId, sellerA.seller.id)),
      ),
    ).toBe(RESTRICT_VIOLATION)
    expect(
      await errorCode(
        owner
          .delete(sellerLedgerEntries)
          .where(eq(sellerLedgerEntries.sellerId, sellerA.seller.id)),
      ),
    ).toBe(RESTRICT_VIOLATION)
  })
})

describe('platform logs', () => {
  test('anyone may queue an email but only full access reads the outbox', async () => {
    const toEmail = `${crypto.randomUUID()}@example.test`
    await withContext(web, as.anonymous(), (tx) =>
      tx.insert(emailOutbox).values({
        toEmail,
        template: 'otp',
        subject: 'Your EcoKart code',
      }),
    )
    const countAs = (context: RequestContext) =>
      withContext(
        web,
        context,
        async (tx) =>
          (
            await tx
              .select({ id: emailOutbox.id })
              .from(emailOutbox)
              .where(eq(emailOutbox.toEmail, toEmail))
          ).length,
      )
    expect(await countAs(as.buyer(buyer1))).toBe(0)
    expect(await countAs(as.admin())).toBe(1)
  })

  test('webhook events are hidden from buyers and sellers', async () => {
    const eventId = `evt_${crypto.randomUUID()}`
    await owner.insert(paymentEvents).values({
      provider: 'razorpay',
      eventId,
      eventType: 'payment.captured',
      payload: {},
      signatureValid: true,
    })
    const countAs = (context: RequestContext) =>
      withContext(
        web,
        context,
        async (tx) =>
          (
            await tx
              .select({ id: paymentEvents.id })
              .from(paymentEvents)
              .where(eq(paymentEvents.eventId, eventId))
          ).length,
      )
    expect(await countAs(as.buyer(buyer1))).toBe(0)
    expect(await countAs(as.seller(sellerA))).toBe(0)
    expect(await countAs({ role: 'system' })).toBe(1)
  })
})

describe('worker', () => {
  test('sees every row without any request context', async () => {
    const result = await worker.execute<{ products: number; orders: number }>(
      sql`select
        (select count(*)::int from products where id in ${productIds}) as products,
        (select count(*)::int from orders where id in (${order1.order.id}, ${order2.order.id})) as orders`,
    )
    expect(result.rows[0]).toEqual({ products: 4, orders: 2 })
  })

  test('cannot change table structure', async () => {
    expect(
      await errorCode(
        worker.execute(sql`alter table products add column hacked text`),
      ),
    ).toBe(INSUFFICIENT_PRIVILEGE)
  })
})

/** Seller A opening a review of their approved product, with `values`. */
const openReviewAsSellerA = (
  values: Partial<typeof productModeration.$inferInsert>,
) =>
  errorCode(
    withContext(web, as.seller(sellerA), (tx) =>
      tx
        .insert(productModeration)
        .values({ productId: approvedA.product.id, ...values }),
    ),
  )

/** Changes one review as `context`; the rows it changed. */
const changeReviewAs = (
  context: RequestContext,
  reviewId: string,
  values: Partial<typeof productModeration.$inferInsert>,
) =>
  withContext(web, context, (tx) =>
    tx
      .update(productModeration)
      .set(values)
      .where(eq(productModeration.id, reviewId))
      .returning({ id: productModeration.id }),
  )

describe('listing reviews', () => {
  // One open review each for seller A's and seller B's drafts.
  let reviewA: string
  let reviewB: string

  beforeAll(async () => {
    const rows = await owner
      .insert(productModeration)
      .values([
        { productId: draftA.product.id },
        { productId: draftB.product.id },
      ])
      .returning({ id: productModeration.id })
    reviewA = rows[0]!.id
    reviewB = rows[1]!.id
  })

  const reviewIdsAs = (context: RequestContext) =>
    withContext(web, context, async (tx) =>
      (
        await tx
          .select({ id: productModeration.id })
          .from(productModeration)
          .where(inArray(productModeration.id, [reviewA, reviewB]))
      ).map((row) => row.id),
    )

  test('a seller sees the reviews of their own products only', async () => {
    expect(await reviewIdsAs(as.seller(sellerA))).toEqual([reviewA])
    expect(await reviewIdsAs(as.anonymous())).toEqual([])
    expect(await reviewIdsAs(as.buyer(buyer1))).toEqual([])
    expect(new Set(await reviewIdsAs(as.admin()))).toEqual(
      new Set([reviewA, reviewB]),
    )
  })

  test('a seller opens only an undecided, unscreened review of their own product', async () => {
    expect(
      await openReviewAsSellerA({
        decision: 'approved',
        decidedAt: new Date(),
      }),
    ).toBe(INSUFFICIENT_PRIVILEGE)
    expect(await openReviewAsSellerA({ aiRisk: 'low' })).toBe(
      INSUFFICIENT_PRIVILEGE,
    )
    expect(
      await openReviewAsSellerA({
        aiFlags: [{ code: 'large_discount', detail: 'x' }],
      }),
    ).toBe(INSUFFICIENT_PRIVILEGE)
    expect(await openReviewAsSellerA({ productId: draftB.product.id })).toBe(
      INSUFFICIENT_PRIVILEGE,
    )
  })

  test('only full access screens or decides a review; a seller may only withdraw their own', async () => {
    const decidedAt = new Date()
    expect(
      await errorCode(
        changeReviewAs(as.seller(sellerA), reviewA, { aiRisk: 'low' }),
      ),
    ).toBe(INSUFFICIENT_PRIVILEGE)
    expect(
      await errorCode(
        changeReviewAs(as.seller(sellerA), reviewA, {
          decision: 'approved',
          decidedAt,
        }),
      ),
    ).toBe(INSUFFICIENT_PRIVILEGE)
    expect(
      await changeReviewAs(as.seller(sellerA), reviewB, {
        decision: 'withdrawn',
        decidedAt,
      }),
    ).toEqual([])
    expect(
      await changeReviewAs(as.admin(), reviewA, { aiRisk: 'low' }),
    ).toEqual([{ id: reviewA }])
    expect(
      await changeReviewAs(as.seller(sellerA), reviewA, {
        decision: 'withdrawn',
        decidedBy: sellerA.owner.id,
        decidedAt,
      }),
    ).toEqual([{ id: reviewA }])
    // Once decided, a review is closed to the seller.
    expect(
      await changeReviewAs(as.seller(sellerA), reviewA, { reason: 'Changed' }),
    ).toEqual([])
  })

  test('a seller can never approve or reject their own product, or set its rate', async () => {
    const change = (values: Partial<typeof products.$inferInsert>) =>
      errorCode(
        withContext(web, as.seller(sellerA), (tx) =>
          tx
            .update(products)
            .set(values)
            .where(eq(products.id, draftA.product.id)),
        ),
      )
    expect(
      await change({
        status: 'approved',
        gstRateBps: 500,
        hsnCode: '3924',
        publishedAt: new Date(),
      }),
    ).toBe(INSUFFICIENT_PRIVILEGE)
    expect(await change({ status: 'rejected' })).toBe(INSUFFICIENT_PRIVILEGE)
    expect(await change({ gstRateBps: 500 })).toBe(INSUFFICIENT_PRIVILEGE)
    expect(await change({ publishedAt: new Date() })).toBe(
      INSUFFICIENT_PRIVILEGE,
    )
    expect(
      await errorCode(
        withContext(web, as.seller(sellerA), (tx) =>
          tx.insert(products).values({
            sellerId: sellerA.seller.id,
            categoryId: draftA.product.categoryId,
            title: 'Approved from the start',
            slug: `self-approved-${crypto.randomUUID()}`,
            status: 'approved',
            gstRateBps: 500,
            hsnCode: '3924',
            publishedAt: new Date(),
          }),
        ),
      ),
    ).toBe(INSUFFICIENT_PRIVILEGE)
    // Changes the seller may make still work, for example taking an
    // approved listing off sale.
    const archived = await withContext(web, as.seller(sellerA), (tx) =>
      tx
        .update(products)
        .set({ status: 'archived' })
        .where(eq(products.id, approvedA.product.id))
        .returning({ id: products.id }),
    )
    expect(archived).toEqual([{ id: approvedA.product.id }])
    await owner
      .update(products)
      .set({ status: 'approved' })
      .where(eq(products.id, approvedA.product.id))
  })

  test('the database keeps one open review per product and every decision whole', async () => {
    expect(
      await errorCode(
        owner
          .insert(productModeration)
          .values({ productId: draftB.product.id }),
      ),
    ).toBe(UNIQUE_VIOLATION)
    expect(
      await errorCode(
        owner
          .update(productModeration)
          .set({ decision: 'approved' })
          .where(eq(productModeration.id, reviewB)),
      ),
    ).toBe(CHECK_VIOLATION)
    expect(
      await errorCode(
        owner
          .update(productModeration)
          .set({ decision: 'rejected', decidedAt: new Date() })
          .where(eq(productModeration.id, reviewB)),
      ),
    ).toBe(CHECK_VIOLATION)
    expect(
      await errorCode(
        owner
          .update(products)
          .set({ status: 'approved', publishedAt: null })
          .where(eq(products.id, approvedB.product.id)),
      ),
    ).toBe(CHECK_VIOLATION)
  })
})

// Invoices (backend spec step 14).
const invoiceFor = (
  order: typeof order1,
  s: typeof sellerA,
): typeof invoices.$inferInsert => ({
  orderId: order.order.id,
  sellerId: s.seller.id,
  invoiceNumber: `T${crypto.randomUUID().slice(0, 8).toUpperCase()}/1`,
  issuedAt: new Date(),
  sellerSnapshot: {},
  buyerSnapshot: {},
  placeOfSupplyStateCode: '27',
  isInterstate: false,
  taxablePaise: 42_373,
  cgstPaise: 3_813,
  sgstPaise: 3_814,
  totalPaise: 50_000,
  lines: [{}],
})

describe('invoices', () => {
  // order1 gets an invoice from each seller, order2 one from seller B.
  const invoiceIds: Record<'order1A' | 'order1B' | 'order2B', string> = {
    order1A: '',
    order1B: '',
    order2B: '',
  }

  beforeAll(async () => {
    const rows = await owner
      .insert(invoices)
      .values([
        invoiceFor(order1, sellerA),
        invoiceFor(order1, sellerB),
        invoiceFor(order2, sellerB),
      ])
      .returning({ id: invoices.id })
    invoiceIds.order1A = rows[0]!.id
    invoiceIds.order1B = rows[1]!.id
    invoiceIds.order2B = rows[2]!.id
  })

  const visibleInvoices = (context: RequestContext) =>
    withContext(
      web,
      context,
      async (tx) =>
        new Set(
          (
            await tx
              .select({ id: invoices.id })
              .from(invoices)
              .where(inArray(invoices.id, Object.values(invoiceIds)))
          ).map((row) => row.id),
        ),
    )

  test('a buyer sees every invoice of their own orders only', async () => {
    expect(await visibleInvoices(as.buyer(buyer1))).toEqual(
      new Set([invoiceIds.order1A, invoiceIds.order1B]),
    )
    expect(await visibleInvoices(as.buyer(buyer2))).toEqual(
      new Set([invoiceIds.order2B]),
    )
  })

  test('a seller sees only the invoices they issued, even in a shared order', async () => {
    expect(await visibleInvoices(as.seller(sellerA))).toEqual(
      new Set([invoiceIds.order1A]),
    )
    expect(await visibleInvoices(as.seller(sellerB))).toEqual(
      new Set([invoiceIds.order1B, invoiceIds.order2B]),
    )
  })

  test('administrators and the worker see every invoice; visitors none', async () => {
    expect(await visibleInvoices(as.admin())).toEqual(
      new Set(Object.values(invoiceIds)),
    )
    expect(await visibleInvoices(as.anonymous())).toEqual(new Set())
    const seen = await worker
      .select({ id: invoices.id })
      .from(invoices)
      .where(inArray(invoices.id, Object.values(invoiceIds)))
    expect(seen).toHaveLength(3)
  })

  test('buyers and sellers cannot issue an invoice', async () => {
    for (const context of [as.buyer(buyer1), as.seller(sellerA)]) {
      const code = await errorCode(
        withContext(web, context, (tx) =>
          tx.insert(invoices).values({
            ...invoiceFor(order2, sellerA),
            orderId: order2.order.id,
          }),
        ),
      )
      expect(code).toBe(INSUFFICIENT_PRIVILEGE)
    }
  })

  test('a seller cannot change an invoice they issued', async () => {
    const changed = await withContext(web, as.seller(sellerA), (tx) =>
      tx
        .update(invoices)
        .set({ totalPaise: 1, taxablePaise: 1, cgstPaise: 0, sgstPaise: 0 })
        .where(eq(invoices.id, invoiceIds.order1A))
        .returning({ id: invoices.id }),
    )
    expect(changed).toEqual([])
    const [row] = await owner
      .select({ totalPaise: invoices.totalPaise })
      .from(invoices)
      .where(eq(invoices.id, invoiceIds.order1A))
    expect(row).toEqual({ totalPaise: 50_000 })
  })
})

/** A file uploaded by seller A, as the portal would add it. */
const fileFor = (requestId: string, sellerId: string) => ({
  requestId,
  sellerId,
  uploadKey: `uploads/seller-documents/${requestId}/${crypto.randomUUID()}`,
  uploadedBy: sellerA.owner.id,
})

describe('seller documents', () => {
  // One request for each seller, each with one uploaded file.
  const documents = { requestA: '', requestB: '', fileA: '', fileB: '' }

  beforeAll(async () => {
    const [requestA, requestB] = await owner
      .insert(sellerDocumentRequests)
      .values(
        [sellerA, sellerB].map((s) => ({
          sellerId: s.seller.id,
          documentType: 'pan_card',
          note: 'A clear copy of the PAN card',
          status: 'processing',
          requestedBy: admin.id,
        })),
      )
      .returning()
    const [fileA, fileB] = await owner
      .insert(sellerDocumentFiles)
      .values(
        [
          { s: sellerA, request: requestA! },
          { s: sellerB, request: requestB! },
        ].map(({ s, request }) => ({
          requestId: request.id,
          sellerId: request.sellerId,
          uploadKey: `uploads/seller-documents/${request.id}/${crypto.randomUUID()}`,
          uploadedBy: s.owner.id,
        })),
      )
      .returning()
    Object.assign(documents, {
      requestA: requestA!.id,
      requestB: requestB!.id,
      fileA: fileA!.id,
      fileB: fileB!.id,
    })
  })

  const visible = (context: RequestContext) =>
    withContext(web, context, async (tx) => ({
      requests: (
        await tx
          .select({ id: sellerDocumentRequests.id })
          .from(sellerDocumentRequests)
          .where(
            inArray(sellerDocumentRequests.id, [
              documents.requestA,
              documents.requestB,
            ]),
          )
      ).map((row) => row.id),
      files: (
        await tx
          .select({ id: sellerDocumentFiles.id })
          .from(sellerDocumentFiles)
          .where(
            inArray(sellerDocumentFiles.id, [documents.fileA, documents.fileB]),
          )
      ).map((row) => row.id),
    }))

  test('a seller sees only their own requests and files', async () => {
    expect(await visible(as.seller(sellerA))).toEqual({
      requests: [documents.requestA],
      files: [documents.fileA],
    })
  })

  test('buyers and visitors see none; administrators see all', async () => {
    const none = { requests: [], files: [] }
    expect(await visible(as.buyer(buyer1))).toEqual(none)
    expect(await visible(as.anonymous())).toEqual(none)
    const all = await visible(as.admin())
    expect(all.requests).toHaveLength(2)
    expect(all.files).toHaveLength(2)
  })

  test('a seller cannot ask for documents or decide on their own', async () => {
    const asking = await errorCode(
      withContext(web, as.seller(sellerA), (tx) =>
        tx.insert(sellerDocumentRequests).values({
          sellerId: sellerA.seller.id,
          documentType: 'other',
          note: 'Asked by myself',
        }),
      ),
    )
    expect(asking).toBe(INSUFFICIENT_PRIVILEGE)
    const accepting = await errorCode(
      withContext(web, as.seller(sellerA), (tx) =>
        tx
          .update(sellerDocumentRequests)
          .set({ status: 'accepted', acceptedAt: new Date() })
          .where(eq(sellerDocumentRequests.id, documents.requestA)),
      ),
    )
    expect(accepting).toBe(INSUFFICIENT_PRIVILEGE)
    const reviewing = await withContext(web, as.seller(sellerA), (tx) =>
      tx
        .update(sellerDocumentFiles)
        .set({ status: 'failed', failureReason: 'Changed by the seller' })
        .where(eq(sellerDocumentFiles.id, documents.fileA))
        .returning({ id: sellerDocumentFiles.id }),
    )
    expect(reviewing).toEqual([])
  })

  test('a seller adds files only to their own requests, unchecked', async () => {
    for (const values of [
      // Another seller's request, under either seller's id.
      fileFor(documents.requestB, sellerA.seller.id),
      fileFor(documents.requestB, sellerB.seller.id),
      // Marked as already checked.
      {
        ...fileFor(documents.requestA, sellerA.seller.id),
        status: 'received',
        storageKey: 'seller-documents/x',
        contentType: 'application/pdf',
        sizeBytes: 1,
        contentHash: 'x',
      },
    ]) {
      const code = await errorCode(
        withContext(web, as.seller(sellerA), (tx) =>
          tx.insert(sellerDocumentFiles).values(values),
        ),
      )
      expect(code).toBe(INSUFFICIENT_PRIVILEGE)
    }
  })

  test('a request has at most one file in check or review', async () => {
    const code = await errorCode(
      owner
        .insert(sellerDocumentFiles)
        .values(fileFor(documents.requestA, sellerA.seller.id)),
    )
    expect(code).toBe(UNIQUE_VIOLATION)
  })
})

/** Bank details as an administrator would enter them, sealed. */
const bankAccountFor = (sellerId: string, last4: string) => ({
  sellerId,
  accountHolder: 'Test holder',
  accountNumberSealed: 'v1.not-a-real-iv.not-real-data',
  accountNumberLast4: last4,
  ifsc: 'HDFC0001234',
})

/** A return photo the worker has checked. */
const readyPhoto = (userId: string, returnRequestId: string | null = null) => {
  const id = crypto.randomUUID()
  return {
    id,
    userId,
    returnRequestId,
    uploadKey: `uploads/returns/${userId}/${crypto.randomUUID()}`,
    storageKey: `returns/${id}`,
    status: 'ready',
    contentHash: 'hash',
    width: 800,
    height: 600,
  }
}

/** A return photo as the buyer's browser adds it. */
const unchecked = (userId: string) => ({
  userId,
  uploadKey: `uploads/returns/${userId}/${crypto.randomUUID()}`,
})

describe('seller bank accounts', () => {
  let accountIds: string[]

  beforeAll(async () => {
    const rows = await owner
      .insert(sellerBankAccounts)
      .values([
        bankAccountFor(sellerA.seller.id, '1111'),
        bankAccountFor(sellerB.seller.id, '2222'),
      ])
      .returning({ id: sellerBankAccounts.id })
    accountIds = rows.map((row) => row.id)
  })

  const visibleLast4 = (context: RequestContext) =>
    withContext(web, context, async (tx) =>
      (
        await tx
          .select({ last4: sellerBankAccounts.accountNumberLast4 })
          .from(sellerBankAccounts)
          .where(inArray(sellerBankAccounts.id, accountIds))
      )
        .map((row) => row.last4)
        .toSorted(),
    )

  test('a seller sees only their own; buyers and visitors none', async () => {
    expect(await visibleLast4(as.seller(sellerA))).toEqual(['1111'])
    expect(await visibleLast4(as.buyer(buyer1))).toEqual([])
    expect(await visibleLast4(as.anonymous())).toEqual([])
    expect(await visibleLast4(as.admin())).toEqual(['1111', '2222'])
  })

  test('a seller cannot enter or change bank details', async () => {
    const code = await errorCode(
      withContext(web, as.seller(sellerA), (tx) =>
        tx
          .insert(sellerBankAccounts)
          .values(bankAccountFor(sellerA.seller.id, '9999')),
      ),
    )
    expect(code).toBe(INSUFFICIENT_PRIVILEGE)
    const changed = await withContext(web, as.seller(sellerA), (tx) =>
      tx
        .update(sellerBankAccounts)
        .set({ ifsc: 'SBIN0000001' })
        .where(eq(sellerBankAccounts.sellerId, sellerA.seller.id))
        .returning({ id: sellerBankAccounts.id }),
    )
    expect(changed).toEqual([])
  })
})

describe('return photos', () => {
  // Buyer 1 returns seller A's line of order 1, with one photo attached and
  // one still waiting; buyer 2 has a waiting photo of their own.
  const photos = { attached: '', waiting: '', otherBuyer: '' }
  let returnId: string
  let otherReturnId: string

  beforeAll(async () => {
    const lineOf = (order: typeof order1, sellerId: string) =>
      order.items.find((item) => item.sellerId === sellerId)!
    const [ownReturn, otherReturn] = await owner
      .insert(returnRequests)
      .values([
        {
          orderId: order1.order.id,
          orderItemId: lineOf(order1, sellerA.seller.id).id,
          userId: buyer1.id,
          sellerId: sellerA.seller.id,
          quantity: 1,
          reasonCode: 'damaged',
        },
        {
          orderId: order2.order.id,
          orderItemId: lineOf(order2, sellerB.seller.id).id,
          userId: buyer2.id,
          sellerId: sellerB.seller.id,
          quantity: 1,
          reasonCode: 'damaged',
        },
      ])
      .returning({ id: returnRequests.id })
    returnId = ownReturn!.id
    otherReturnId = otherReturn!.id
    const rows = [
      readyPhoto(buyer1.id, returnId),
      readyPhoto(buyer1.id),
      readyPhoto(buyer2.id),
    ]
    await owner.insert(returnPhotos).values(rows)
    Object.assign(photos, {
      attached: rows[0]!.id,
      waiting: rows[1]!.id,
      otherBuyer: rows[2]!.id,
    })
  })

  const visiblePhotos = (context: RequestContext) =>
    withContext(web, context, async (tx) =>
      (
        await tx
          .select({ id: returnPhotos.id })
          .from(returnPhotos)
          .where(inArray(returnPhotos.id, Object.values(photos)))
      )
        .map((row) => row.id)
        .toSorted(),
    )

  test('the buyer sees their own; the seller only those sent with their return', async () => {
    expect(await visiblePhotos(as.buyer(buyer1))).toEqual(
      [photos.attached, photos.waiting].toSorted(),
    )
    expect(await visiblePhotos(as.buyer(buyer2))).toEqual([photos.otherBuyer])
    expect(await visiblePhotos(as.seller(sellerA))).toEqual([photos.attached])
    expect(await visiblePhotos(as.seller(sellerB))).toEqual([])
    expect(await visiblePhotos(as.anonymous())).toEqual([])
    expect(await visiblePhotos(as.admin())).toHaveLength(3)
  })

  test('a buyer adds only unchecked photos of their own', async () => {
    for (const values of [
      unchecked(buyer2.id),
      readyPhoto(buyer1.id),
      { ...unchecked(buyer1.id), returnRequestId: returnId },
    ]) {
      const code = await errorCode(
        withContext(web, as.buyer(buyer1), (tx) =>
          tx.insert(returnPhotos).values(values),
        ),
      )
      expect(code).toBe(INSUFFICIENT_PRIVILEGE)
    }
  })

  test('a buyer attaches photos only to their own return', async () => {
    const code = await errorCode(
      withContext(web, as.buyer(buyer1), (tx) =>
        tx
          .update(returnPhotos)
          .set({ returnRequestId: otherReturnId })
          .where(eq(returnPhotos.id, photos.waiting)),
      ),
    )
    expect(code).toBe(INSUFFICIENT_PRIVILEGE)
    const changed = await withContext(web, as.buyer(buyer2), (tx) =>
      tx
        .update(returnPhotos)
        .set({ returnRequestId: otherReturnId })
        .where(eq(returnPhotos.id, photos.waiting))
        .returning({ id: returnPhotos.id }),
    )
    expect(changed).toEqual([])
    const sellerChange = await withContext(web, as.seller(sellerA), (tx) =>
      tx
        .update(returnPhotos)
        .set({ returnRequestId: null })
        .where(eq(returnPhotos.id, photos.attached))
        .returning({ id: returnPhotos.id }),
    )
    expect(sellerChange).toEqual([])
  })
})

describe('settlement statements', () => {
  let statementIds: string[]

  beforeAll(async () => {
    const rows = await owner
      .insert(settlementStatements)
      .values(
        [sellerA, sellerB].map(({ seller }) => ({
          sellerId: seller.id,
          periodStart: '2026-10-01',
          periodEnd: '2026-10-19',
        })),
      )
      .returning({ id: settlementStatements.id })
    statementIds = rows.map((row) => row.id)
  })

  const visibleSellers = (context: RequestContext) =>
    withContext(web, context, async (tx) =>
      (
        await tx
          .select({ sellerId: settlementStatements.sellerId })
          .from(settlementStatements)
          .where(inArray(settlementStatements.id, statementIds))
      )
        .map((row) => row.sellerId)
        .toSorted(),
    )

  test('a seller sees only their own; buyers and visitors none', async () => {
    expect(await visibleSellers(as.seller(sellerA))).toEqual([
      sellerA.seller.id,
    ])
    expect(await visibleSellers(as.buyer(buyer1))).toEqual([])
    expect(await visibleSellers(as.anonymous())).toEqual([])
    expect(await visibleSellers(as.admin())).toEqual(
      [sellerA.seller.id, sellerB.seller.id].toSorted(),
    )
  })

  test('a seller asks only for their own, and only the worker fills it in', async () => {
    await withContext(web, as.seller(sellerA), (tx) =>
      tx.insert(settlementStatements).values({
        sellerId: sellerA.seller.id,
        periodStart: '2026-10-01',
        periodEnd: '2026-10-01',
      }),
    )
    for (const values of [
      {
        sellerId: sellerB.seller.id,
        periodStart: '2026-10-01',
        periodEnd: '2026-10-01',
      },
      {
        sellerId: sellerA.seller.id,
        periodStart: '2026-10-01',
        periodEnd: '2026-10-01',
        status: 'failed',
        failureReason: 'Made up',
      },
    ]) {
      const code = await errorCode(
        withContext(web, as.seller(sellerA), (tx) =>
          tx.insert(settlementStatements).values(values),
        ),
      )
      expect(code).toBe(INSUFFICIENT_PRIVILEGE)
    }
    const code = await errorCode(
      withContext(web, as.admin(), (tx) =>
        tx
          .update(settlementStatements)
          .set({ status: 'failed', failureReason: 'Made up' })
          .where(eq(settlementStatements.id, statementIds[0]!)),
      ),
    )
    expect(code).toBe(INSUFFICIENT_PRIVILEGE)
    const filled = await withContext(worker, { role: 'system' }, (tx) =>
      tx
        .update(settlementStatements)
        .set({ status: 'failed', failureReason: 'Storage was down' })
        .where(eq(settlementStatements.id, statementIds[1]!))
        .returning({ id: settlementStatements.id }),
    )
    expect(filled).toHaveLength(1)
  })

  test('a period is at most 366 days and never backwards', async () => {
    for (const [periodStart, periodEnd] of [
      ['2026-10-02', '2026-10-01'],
      ['2025-10-18', '2026-10-19'],
    ]) {
      const code = await errorCode(
        owner.insert(settlementStatements).values({
          sellerId: sellerA.seller.id,
          periodStart: periodStart!,
          periodEnd: periodEnd!,
        }),
      )
      expect(code).toBe(CHECK_VIOLATION)
    }
  })
})
