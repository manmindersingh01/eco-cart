import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import {
  brands,
  categories,
  orderItems,
  orders,
  productVariants,
  products,
  sellers,
  users,
} from '../db/schema/index.ts'
import type { OrderToInvoice } from '../modules/invoices/types.ts'

/*
 * Test data, inserted as the database owner so row-level security does not
 * apply. Application code reads and writes users only through Better Auth;
 * tests insert them directly because they only need the row to exist.
 * Every value is unique, so test files can run in parallel on one database.
 */

const uniqueSuffix = () => randomUUID().replaceAll('-', '').slice(0, 10)

export async function createTestUser(
  db: Database,
  role: 'buyer' | 'seller' | 'admin' = 'buyer',
) {
  const suffix = uniqueSuffix()
  const [user] = await db
    .insert(users)
    .values({
      name: `Test ${role} ${suffix}`,
      email: `${role}-${suffix}@example.test`,
      emailVerified: true,
      role,
    })
    .returning()
  return user!
}

export async function createTestSeller(
  db: Database,
  status: 'pending' | 'approved' | 'suspended' = 'approved',
) {
  const owner = await createTestUser(db, 'seller')
  const suffix = uniqueSuffix()
  const [seller] = await db
    .insert(sellers)
    .values({
      ownerUserId: owner.id,
      slug: `seller-${suffix}`,
      displayName: `Seller ${suffix}`,
      legalName: `Seller ${suffix} Private Limited`,
      line1: '12 MG Road',
      city: 'Pune',
      stateCode: '27',
      pincode: '411001',
      supportEmail: `support-${suffix}@example.test`,
      supportPhone: '+919800000000',
      invoicePrefix: (await testInvoicePrefixes(db))[0]!,
      status,
    })
    .returning()
  return { owner, seller: seller! }
}

/**
 * Free invoice prefixes such as T01A, unique within the test run. Prefixes
 * have only 4 characters, so the test database counts them out
 * (testing/database.ts) instead of leaving them to chance.
 */
export async function testInvoicePrefixes(
  db: Database,
  count = 1,
): Promise<string[]> {
  const result = await db.execute<{ n: string }>(
    sql`select nextval('test_invoice_prefixes') as n from generate_series(1, ${count})`,
  )
  return result.rows.map(
    ({ n }) => `T${Number(n).toString(36).toUpperCase().padStart(3, '0')}`,
  )
}

export async function createTestCategory(db: Database) {
  const suffix = uniqueSuffix()
  const [category] = await db
    .insert(categories)
    .values({
      name: `Category ${suffix}`,
      slug: `category-${suffix}`,
      gstRateBps: 1800,
      defaultHsnCode: '3924',
    })
    .returning()
  return category!
}

export async function createTestBrand(db: Database, isActive = true) {
  const suffix = uniqueSuffix()
  const [brand] = await db
    .insert(brands)
    .values({ name: `Brand ${suffix}`, slug: `brand-${suffix}`, isActive })
    .returning()
  return brand!
}

/** A product with one variant priced at ₹500 (MRP ₹600) and 5 in stock. */
export async function createTestProduct(
  db: Database,
  options: {
    sellerId: string
    categoryId: string
    brandId?: string
    status?: 'draft' | 'pending_review' | 'approved' | 'rejected' | 'archived'
  },
) {
  const suffix = uniqueSuffix()
  const [product] = await db
    .insert(products)
    .values({
      sellerId: options.sellerId,
      categoryId: options.categoryId,
      brandId: options.brandId ?? null,
      title: `Bamboo bottle ${suffix}`,
      slug: `bamboo-bottle-${suffix}`,
      status: options.status ?? 'approved',
      hsnCode: '3924',
      gstRateBps: 1800,
      minPricePaise: 50_000,
      maxPricePaise: 50_000,
      minMrpPaise: 60_000,
      totalStock: 5,
      searchText: `bamboo bottle ${suffix}`,
    })
    .returning()
  const [variant] = await db
    .insert(productVariants)
    .values({
      productId: product!.id,
      sku: `SKU-${suffix}`,
      pricePaise: 50_000,
      mrpPaise: 60_000,
      stock: 5,
    })
    .returning()
  return { product: product!, variant: variant! }
}

/**
 * A confirmed order with one ₹500 line per product, each from its own
 * seller. The amounts satisfy every money check on the two tables.
 */
export async function createTestOrder(
  db: Database,
  options: {
    buyerId: string
    lines: {
      sellerId: string
      productId: string
      variantId: string
    }[]
  },
) {
  const unitPricePaise = 50_000
  // 18% GST back-calculated from the tax-inclusive price.
  const taxablePaise = Math.round((unitPricePaise * 10_000) / 11_800)
  const taxPaise = unitPricePaise - taxablePaise
  const subtotalPaise = unitPricePaise * options.lines.length

  const [order] = await db
    .insert(orders)
    .values({
      orderNumber: `EK-TEST-${uniqueSuffix()}`,
      userId: options.buyerId,
      status: 'confirmed',
      paymentMethod: 'cod',
      subtotalPaise,
      taxPaise: taxPaise * options.lines.length,
      totalPaise: subtotalPaise,
      shippingAddress: {
        fullName: 'Asha Patil',
        phone: '+919800000001',
        line1: '4 FC Road',
        line2: null,
        landmark: null,
        city: 'Pune',
        stateCode: '27',
        pincode: '411004',
      },
      buyerName: 'Asha Patil',
      buyerPhone: '+919800000001',
    })
    .returning()

  const items = await db
    .insert(orderItems)
    .values(
      options.lines.map((line) => ({
        orderId: order!.id,
        sellerId: line.sellerId,
        productId: line.productId,
        variantId: line.variantId,
        title: 'Bamboo bottle',
        sku: 'SKU',
        options: {},
        hsnCode: '3924',
        gstRateBps: 1800,
        unitPricePaise,
        unitMrpPaise: 60_000,
        quantity: 1,
        lineTotalPaise: unitPricePaise,
        taxablePaise,
        taxPaise,
        commissionBps: 1000,
        commissionPaise: 5_000,
      })),
    )
    .returning()

  return { order: order!, items }
}

// Invoices (backend spec step 14).

/** An approved seller that can issue invoices: a GSTIN and PAN for its state. */
export async function createTestInvoicingSeller(
  db: Database,
  options: { stateCode?: string } = {},
) {
  const stateCode = options.stateCode ?? '27'
  const { owner, seller } = await createTestSeller(db, 'approved')
  const [ready] = await db
    .update(sellers)
    .set({
      stateCode,
      gstin: `${stateCode}AAACE1234F1Z5`,
      pan: 'AAACE1234F',
      approvedAt: new Date(),
    })
    .where(eq(sellers.id, seller.id))
    .returning()
  return { owner, seller: ready! }
}

export interface TestOrderLine {
  sellerId: string
  productId: string
  variantId: string
  title?: string
  options?: Record<string, string>
  hsnCode?: string
  gstRateBps?: number
  unitPricePaise?: number
  quantity?: number
  discountSharePaise?: number
  status?: string
}

/**
 * An order with lines priced as given (by default one ₹500 unit at 18%),
 * delivered in `shippingStateCode`. Tax is back-calculated from each line's
 * tax-inclusive amount after its discount, as checkout does. Lines are
 * inserted one at a time, so they keep the given order.
 */
export async function createTestOrderWithLines(
  db: Database,
  options: {
    buyerId: string
    lines: TestOrderLine[]
    shippingStateCode?: string
    paymentMethod?: 'razorpay' | 'cod'
    status?: 'pending_payment' | 'confirmed' | 'cancelled' | 'completed'
  },
) {
  const lines = options.lines.map((line) => {
    const gstRateBps = line.gstRateBps ?? 1800
    const unitPricePaise = line.unitPricePaise ?? 50_000
    const quantity = line.quantity ?? 1
    const discountSharePaise = line.discountSharePaise ?? 0
    const lineTotalPaise = unitPricePaise * quantity
    const net = lineTotalPaise - discountSharePaise
    const taxablePaise = Math.round((net * 10_000) / (10_000 + gstRateBps))
    return {
      ...line,
      gstRateBps,
      unitPricePaise,
      quantity,
      discountSharePaise,
      lineTotalPaise,
      taxablePaise,
      taxPaise: net - taxablePaise,
      commissionPaise: Math.floor(net / 10),
    }
  })
  const sum = (amount: (line: (typeof lines)[number]) => number) =>
    lines.reduce((total, line) => total + amount(line), 0)
  const subtotalPaise = sum((line) => line.lineTotalPaise)
  const discountPaise = sum((line) => line.discountSharePaise)

  const [order] = await db
    .insert(orders)
    .values({
      orderNumber: `EK-TEST-${uniqueSuffix()}`,
      userId: options.buyerId,
      status: options.status ?? 'confirmed',
      paymentMethod: options.paymentMethod ?? 'razorpay',
      subtotalPaise,
      discountPaise,
      taxPaise: sum((line) => line.taxPaise),
      totalPaise: subtotalPaise - discountPaise,
      shippingAddress: {
        fullName: 'Asha Patil',
        phone: '+919800000001',
        line1: '4 FC Road',
        line2: 'Shivajinagar',
        landmark: null,
        city: 'Pune',
        stateCode: options.shippingStateCode ?? '27',
        pincode: '411004',
      },
      buyerName: 'Asha Patil',
      buyerPhone: '+919800000001',
      buyerEmail: 'asha@example.test',
    })
    .returning()

  const items = []
  for (const line of lines) {
    const [item] = await db
      .insert(orderItems)
      .values({
        orderId: order!.id,
        sellerId: line.sellerId,
        productId: line.productId,
        variantId: line.variantId,
        title: line.title ?? 'Bamboo bottle',
        sku: `SKU-${uniqueSuffix()}`,
        options: line.options ?? {},
        hsnCode: line.hsnCode ?? '3924',
        gstRateBps: line.gstRateBps,
        unitPricePaise: line.unitPricePaise,
        unitMrpPaise: line.unitPricePaise,
        quantity: line.quantity,
        lineTotalPaise: line.lineTotalPaise,
        discountSharePaise: line.discountSharePaise,
        taxablePaise: line.taxablePaise,
        taxPaise: line.taxPaise,
        commissionBps: 1000,
        commissionPaise: line.commissionPaise,
        ...(line.status ? { status: line.status } : {}),
      })
      .returning()
    items.push(item!)
  }
  return { order: order!, items }
}

/**
 * What payment confirmation (step 12) hands to `issueInvoices` for an order
 * made above: the order's frozen details and its lines in their order,
 * without cancelled ones.
 */
export function orderToInvoiceFor(
  order: typeof orders.$inferSelect,
  items: (typeof orderItems.$inferSelect)[],
): OrderToInvoice {
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    placedAt: order.placedAt,
    paymentMethod: order.paymentMethod === 'cod' ? 'cod' : 'razorpay',
    buyer: {
      userId: order.userId,
      name: order.buyerName,
      shippingAddress: order.shippingAddress,
    },
    lines: items.filter((item) => item.status !== 'cancelled'),
  }
}
