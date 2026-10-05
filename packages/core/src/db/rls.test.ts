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
  orderItems,
  orders,
  paymentEvents,
  productVariants,
  products,
  sellerLedgerEntries,
  sellers,
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

  test('only full access can create a seller', async () => {
    const code = await errorCode(
      withContext(web, as.buyer(buyer1), (tx) =>
        tx.insert(sellers).values({
          ownerUserId: buyer1.id,
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
        }),
      ),
    )
    expect(code).toBe(INSUFFICIENT_PRIVILEGE)
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
