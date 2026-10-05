import { randomUUID } from 'node:crypto'
import type { Database } from '../db/client.ts'
import {
  categories,
  orderItems,
  orders,
  productVariants,
  products,
  sellers,
  users,
} from '../db/schema/index.ts'

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
      invoicePrefix: suffix.slice(0, 6).toUpperCase(),
      status,
    })
    .returning()
  return { owner, seller: seller! }
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
