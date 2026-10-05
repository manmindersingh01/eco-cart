import { sql } from 'drizzle-orm'
import {
  bigserial,
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { users } from './auth.ts'
import { coupons } from './cart.ts'
import { productVariants, products } from './catalogue.ts'
import {
  actorRoleCheck,
  createdAt,
  paise,
  timestamptz,
  updatedAt,
  uuidPrimaryKey,
} from './columns.ts'
import { refunds } from './payments.ts'
import {
  currentSellerId,
  currentUserId,
  fullAccess,
  isOrderBuyer,
  webInsert,
  webSelect,
  webUpdate,
  workerPolicy,
} from './rls.ts'
import { sellers } from './sellers.ts'

/** Snapshot of the delivery address taken at checkout. */
export interface ShippingAddressSnapshot {
  fullName: string
  phone: string
  line1: string
  line2: string | null
  landmark: string | null
  city: string
  stateCode: string
  pincode: string
}

/**
 * One buyer order, which can hold items from several sellers. The status only
 * tracks payment and cancellation; fulfilment lives on the items and
 * shipments (design doc 5.7).
 */
export const orders = pgTable(
  'orders',
  {
    id: uuidPrimaryKey(),
    orderNumber: text('order_number').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    status: text('status').notNull(),
    paymentMethod: text('payment_method').notNull(),
    subtotalPaise: paise('subtotal_paise').notNull(),
    discountPaise: paise('discount_paise').notNull().default(0),
    deliveryPaise: paise('delivery_paise').notNull().default(0),
    taxPaise: paise('tax_paise').notNull(),
    totalPaise: paise('total_paise').notNull(),
    couponId: uuid('coupon_id').references(() => coupons.id),
    couponCode: text('coupon_code'),
    shippingAddress: jsonb('shipping_address')
      .$type<ShippingAddressSnapshot>()
      .notNull(),
    buyerName: text('buyer_name').notNull(),
    buyerPhone: text('buyer_phone').notNull(),
    buyerEmail: text('buyer_email'),
    placedAt: timestamptz('placed_at').notNull().defaultNow(),
    paidAt: timestamptz('paid_at'),
    cancelledAt: timestamptz('cancelled_at'),
    completedAt: timestamptz('completed_at'),
    cancelReason: text('cancel_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('orders_user_id_created_at_idx').on(
      t.userId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index('orders_status_created_at_idx').on(t.status, t.createdAt, t.id),
    check(
      'orders_status_check',
      sql`status in ('pending_payment', 'confirmed', 'cancelled', 'completed')`,
    ),
    check(
      'orders_payment_method_check',
      sql`payment_method in ('razorpay', 'cod')`,
    ),
    check(
      'orders_amounts_check',
      sql`subtotal_paise >= 0 and discount_paise >= 0 and delivery_paise >= 0 and tax_paise >= 0 and discount_paise <= subtotal_paise`,
    ),
    // Prices are tax inclusive, so tax is already inside the subtotal.
    check(
      'orders_total_check',
      sql`total_paise = subtotal_paise - discount_paise + delivery_paise`,
    ),
    webSelect(
      sql`user_id = ${currentUserId} or ${fullAccess} or app.is_order_seller(orders.id)`,
    ),
    webInsert(sql`user_id = ${currentUserId} or ${fullAccess}`),
    webUpdate(fullAccess),
    workerPolicy(),
  ],
).enableRLS()

export const shipments = pgTable(
  'shipments',
  {
    id: uuidPrimaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => sellers.id),
    courierName: text('courier_name').notNull(),
    trackingNumber: text('tracking_number').notNull(),
    trackingUrl: text('tracking_url'),
    status: text('status').notNull().default('dispatched'),
    dispatchedAt: timestamptz('dispatched_at').notNull().defaultNow(),
    deliveredAt: timestamptz('delivered_at'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('shipments_order_id_seller_id_idx').on(t.orderId, t.sellerId),
    check('shipments_status_check', sql`status in ('dispatched', 'delivered')`),
    webSelect(
      sql`seller_id = ${currentSellerId} or ${fullAccess} or ${isOrderBuyer('shipments.order_id')}`,
    ),
    webInsert(sql`seller_id = ${currentSellerId} or ${fullAccess}`),
    webUpdate(sql`seller_id = ${currentSellerId} or ${fullAccess}`),
    workerPolicy(),
  ],
).enableRLS()

/** Everything the line shows is a snapshot taken at checkout (design doc 5.1). */
export const orderItems = pgTable(
  'order_items',
  {
    id: uuidPrimaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => sellers.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id),
    shipmentId: uuid('shipment_id').references(() => shipments.id),
    title: text('title').notNull(),
    sku: text('sku').notNull(),
    options: jsonb('options').$type<Record<string, string>>().notNull(),
    imageKey: text('image_key'),
    hsnCode: text('hsn_code').notNull(),
    gstRateBps: integer('gst_rate_bps').notNull(),
    unitPricePaise: paise('unit_price_paise').notNull(),
    unitMrpPaise: paise('unit_mrp_paise').notNull(),
    quantity: integer('quantity').notNull(),
    lineTotalPaise: paise('line_total_paise').notNull(),
    discountSharePaise: paise('discount_share_paise').notNull().default(0),
    taxablePaise: paise('taxable_paise').notNull(),
    taxPaise: paise('tax_paise').notNull(),
    commissionBps: integer('commission_bps').notNull(),
    commissionPaise: paise('commission_paise').notNull(),
    status: text('status').notNull().default('confirmed'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('order_items_order_id_idx').on(t.orderId),
    index('order_items_seller_id_status_created_at_idx').on(
      t.sellerId,
      t.status,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    check(
      'order_items_status_check',
      sql`status in ('confirmed', 'dispatched', 'delivered', 'cancelled', 'return_requested', 'returned')`,
    ),
    check('order_items_quantity_check', sql`quantity > 0`),
    check(
      'order_items_prices_check',
      sql`unit_price_paise > 0 and unit_mrp_paise >= unit_price_paise`,
    ),
    check(
      'order_items_line_total_check',
      sql`line_total_paise = unit_price_paise * quantity`,
    ),
    check(
      'order_items_discount_share_check',
      sql`discount_share_paise between 0 and line_total_paise`,
    ),
    // Tax is back-calculated from the tax-inclusive amount after discount.
    check(
      'order_items_tax_check',
      sql`taxable_paise >= 0 and tax_paise >= 0 and taxable_paise + tax_paise = line_total_paise - discount_share_paise`,
    ),
    check(
      'order_items_gst_rate_bps_check',
      sql`gst_rate_bps between 0 and 10000`,
    ),
    check(
      'order_items_commission_check',
      sql`commission_bps between 0 and 10000 and commission_paise >= 0`,
    ),
    // Sellers see only their own lines; the buyer sees every line of the order.
    webSelect(
      sql`seller_id = ${currentSellerId} or ${fullAccess} or ${isOrderBuyer('order_items.order_id')}`,
    ),
    webInsert(fullAccess),
    webUpdate(sql`seller_id = ${currentSellerId} or ${fullAccess}`),
    workerPolicy(),
  ],
).enableRLS()

/** Append-only history of every order state change (design doc 5.7). */
export const orderEvents = pgTable(
  'order_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    orderItemId: uuid('order_item_id').references(() => orderItems.id),
    actorUserId: uuid('actor_user_id'),
    actorRole: text('actor_role').notNull(),
    eventType: text('event_type').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    index('order_events_order_id_created_at_idx').on(t.orderId, t.createdAt),
    check('order_events_actor_role_check', actorRoleCheck()),
    // Visible with the order, limited to the lines the viewer can see.
    webSelect(
      sql`${fullAccess} or (exists (select 1 from orders o where o.id = order_events.order_id) and (order_events.order_item_id is null or exists (select 1 from order_items oi where oi.id = order_events.order_item_id)))`,
    ),
    webInsert(
      sql`${fullAccess} or exists (select 1 from orders o where o.id = order_events.order_id)`,
    ),
    workerPolicy(),
  ],
).enableRLS()

export const returnRequests = pgTable(
  'return_requests',
  {
    id: uuidPrimaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => sellers.id),
    quantity: integer('quantity').notNull(),
    reasonCode: text('reason_code').notNull(),
    reasonText: text('reason_text'),
    // Storage keys of the buyer's photos.
    images: jsonb('images')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    status: text('status').notNull().default('requested'),
    adminNote: text('admin_note'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamptz('decided_at'),
    refundId: uuid('refund_id').references((): AnyPgColumn => refunds.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('return_requests_status_created_at_idx').on(
      t.status,
      t.createdAt,
      t.id,
    ),
    index('return_requests_user_id_idx').on(t.userId),
    index('return_requests_seller_id_idx').on(t.sellerId),
    check(
      'return_requests_status_check',
      sql`status in ('requested', 'approved', 'rejected', 'refunded')`,
    ),
    check('return_requests_quantity_check', sql`quantity > 0`),
    webSelect(
      sql`user_id = ${currentUserId} or seller_id = ${currentSellerId} or ${fullAccess}`,
    ),
    webInsert(sql`user_id = ${currentUserId} or ${fullAccess}`),
    webUpdate(fullAccess),
    workerPolicy(),
  ],
).enableRLS()

/** One GST invoice per order per seller, frozen as printed (design doc 5.7). */
export const invoices = pgTable(
  'invoices',
  {
    id: uuidPrimaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => sellers.id),
    invoiceNumber: text('invoice_number').notNull().unique(),
    issuedAt: timestamptz('issued_at').notNull(),
    sellerSnapshot: jsonb('seller_snapshot').notNull(),
    buyerSnapshot: jsonb('buyer_snapshot').notNull(),
    placeOfSupplyStateCode: char('place_of_supply_state_code', {
      length: 2,
    }).notNull(),
    isInterstate: boolean('is_interstate').notNull(),
    taxablePaise: paise('taxable_paise').notNull(),
    cgstPaise: paise('cgst_paise').notNull().default(0),
    sgstPaise: paise('sgst_paise').notNull().default(0),
    igstPaise: paise('igst_paise').notNull().default(0),
    totalPaise: paise('total_paise').notNull(),
    lines: jsonb('lines').notNull(),
    pdfStorageKey: text('pdf_storage_key'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('invoices_order_id_seller_id_key').on(t.orderId, t.sellerId),
    check(
      'invoices_place_of_supply_check',
      sql`place_of_supply_state_code ~ '^[0-9]{2}$'`,
    ),
    // Intra-state invoices use CGST plus SGST, inter-state ones use IGST.
    check(
      'invoices_gst_split_check',
      sql`(is_interstate and cgst_paise = 0 and sgst_paise = 0) or (not is_interstate and igst_paise = 0)`,
    ),
    check(
      'invoices_amounts_check',
      sql`taxable_paise >= 0 and cgst_paise >= 0 and sgst_paise >= 0 and igst_paise >= 0 and total_paise = taxable_paise + cgst_paise + sgst_paise + igst_paise`,
    ),
    webSelect(
      sql`seller_id = ${currentSellerId} or ${fullAccess} or ${isOrderBuyer('invoices.order_id')}`,
    ),
    webInsert(fullAccess),
    webUpdate(fullAccess),
    workerPolicy(),
  ],
).enableRLS()
