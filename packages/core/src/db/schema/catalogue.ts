import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
  vector,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { aiRequests } from './ai.ts'
import { users } from './auth.ts'
import {
  createdAt,
  paise,
  timestamptz,
  tsvector,
  updatedAt,
  uuidPrimaryKey,
} from './columns.ts'
import {
  currentSellerId,
  fullAccess,
  webDelete,
  webInsert,
  webSelect,
  webUpdate,
  workerPolicy,
} from './rls.ts'
import { sellers } from './sellers.ts'

/** Category tree with the GST rate approved per category (design doc 5.5). */
export const categories = pgTable(
  'categories',
  {
    id: uuidPrimaryKey(),
    parentId: uuid('parent_id').references((): AnyPgColumn => categories.id),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    depth: integer('depth').notNull().default(0),
    gstRateBps: integer('gst_rate_bps').notNull(),
    defaultHsnCode: text('default_hsn_code'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('categories_parent_id_sort_order_idx').on(t.parentId, t.sortOrder),
    // Siblings never share a name, ignoring case; top-level categories count
    // as siblings of each other.
    uniqueIndex('categories_parent_id_name_unique').on(
      sql`coalesce(${t.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`lower(${t.name})`,
    ),
    // Three levels at most, for example Home & Kitchen > Kitchen & Dining >
    // Bamboo Kitchenware (backend spec, step 5).
    check('categories_depth_check', sql`depth between 0 and 2`),
    check(
      'categories_depth_parent_check',
      sql`(parent_id is null) = (depth = 0)`,
    ),
    check('categories_slug_check', sql`slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check(
      'categories_gst_rate_bps_check',
      sql`gst_rate_bps between 0 and 10000`,
    ),
    check(
      'categories_default_hsn_code_check',
      sql`default_hsn_code ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$'`,
    ),
  ],
)

export const brands = pgTable(
  'brands',
  {
    id: uuidPrimaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One brand per name ignoring case, and the A to Z order of brand lists.
    uniqueIndex('brands_name_unique').on(sql`lower(${t.name})`),
    check('brands_slug_check', sql`slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
)

// A product is visible to whoever may see it under the products policies, so
// child tables reuse that rule instead of repeating it.
const productVisible = (column: string) =>
  sql`exists (select 1 from products p where p.id = ${sql.raw(column)})`
const productEditable = (column: string) =>
  sql`exists (select 1 from products p where p.id = ${sql.raw(column)} and (p.seller_id = ${currentSellerId} or ${fullAccess}))`

export const products = pgTable(
  'products',
  {
    id: uuidPrimaryKey(),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => sellers.id),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
    brandId: uuid('brand_id').references(() => brands.id),
    title: text('title').notNull(),
    slug: text('slug').notNull().unique(),
    description: text('description').notNull().default(''),
    highlights: jsonb('highlights')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    attributes: jsonb('attributes')
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    optionNames: text('option_names')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    hsnCode: text('hsn_code'),
    // Copied from the category at approval and frozen on each order line.
    gstRateBps: integer('gst_rate_bps'),
    status: text('status').notNull().default('draft'),
    rejectionReason: text('rejection_reason'),
    publishedAt: timestamptz('published_at'),
    // Summary fields kept current by the catalogue service on every write,
    // so listing and search pages read one table (design doc 5.1).
    minPricePaise: paise('min_price_paise'),
    maxPricePaise: paise('max_price_paise'),
    minMrpPaise: paise('min_mrp_paise'),
    totalStock: integer('total_stock').notNull().default(0),
    inStock: boolean('in_stock').generatedAlwaysAs(sql`total_stock > 0`),
    ratingAvg: numeric('rating_avg', { precision: 3, scale: 2 })
      .notNull()
      .default('0'),
    ratingCount: integer('rating_count').notNull().default(0),
    primaryImageId: uuid('primary_image_id').references(
      (): AnyPgColumn => productImages.id,
      { onDelete: 'set null' },
    ),
    searchText: text('search_text').notNull().default(''),
    // Keyword search must query with the same 'english' configuration.
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`to_tsvector('english', search_text)`,
    ),
    aiDraftRequestId: uuid('ai_draft_request_id').references(
      (): AnyPgColumn => aiRequests.id,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    index('products_seller_id_status_idx').on(t.sellerId, t.status),
    index('products_category_id_status_idx').on(t.categoryId, t.status),
    index('products_status_created_at_idx').on(
      t.status,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index('products_status_min_price_paise_idx').on(
      t.status,
      t.minPricePaise,
      t.id,
    ),
    index('products_search_vector_idx').using('gin', t.searchVector),
    index('products_search_text_trgm_idx').using(
      'gin',
      t.searchText.op('gin_trgm_ops'),
    ),
    check(
      'products_status_check',
      sql`status in ('draft', 'pending_review', 'approved', 'rejected', 'archived')`,
    ),
    check(
      'products_hsn_code_check',
      sql`hsn_code ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$'`,
    ),
    check('products_gst_rate_bps_check', sql`gst_rate_bps between 0 and 10000`),
    check('products_total_stock_check', sql`total_stock >= 0`),
    check(
      'products_price_range_check',
      sql`min_price_paise > 0 and max_price_paise >= min_price_paise and min_mrp_paise >= min_price_paise`,
    ),
    check(
      'products_rating_check',
      sql`rating_avg between 0 and 5 and rating_count >= 0`,
    ),
    // Visitors see a product only while both it and its seller are
    // approved, so suspending a seller hides all their listings at once.
    webSelect(
      sql`(status = 'approved' and deleted_at is null and exists (select 1 from sellers s where s.id = products.seller_id and s.status = 'approved')) or seller_id = ${currentSellerId} or ${fullAccess}`,
    ),
    webInsert(sql`seller_id = ${currentSellerId} or ${fullAccess}`),
    webUpdate(sql`seller_id = ${currentSellerId} or ${fullAccess}`),
    workerPolicy(),
  ],
).enableRLS()

export const productVariants = pgTable(
  'product_variants',
  {
    id: uuidPrimaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    sku: text('sku').notNull(),
    options: jsonb('options')
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    pricePaise: paise('price_paise').notNull(),
    mrpPaise: paise('mrp_paise').notNull(),
    stock: integer('stock').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('product_variants_product_id_sku_key').on(t.productId, t.sku),
    check('product_variants_price_paise_check', sql`price_paise > 0`),
    check('product_variants_mrp_paise_check', sql`mrp_paise >= price_paise`),
    check('product_variants_stock_check', sql`stock >= 0`),
    webSelect(productVisible('product_variants.product_id')),
    webInsert(productEditable('product_variants.product_id')),
    webUpdate(productEditable('product_variants.product_id')),
    webDelete(productEditable('product_variants.product_id')),
    workerPolicy(),
  ],
).enableRLS()

export const productImages = pgTable(
  'product_images',
  {
    id: uuidPrimaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    variantId: uuid('variant_id').references(() => productVariants.id),
    storageKey: text('storage_key').notNull().unique(),
    // Filled in by the worker once the upload has been processed.
    contentHash: text('content_hash'),
    width: integer('width'),
    height: integer('height'),
    alt: text('alt').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('product_images_product_id_sort_order_idx').on(
      t.productId,
      t.sortOrder,
    ),
    check('product_images_dimensions_check', sql`width > 0 and height > 0`),
    webSelect(productVisible('product_images.product_id')),
    webInsert(productEditable('product_images.product_id')),
    webUpdate(productEditable('product_images.product_id')),
    webDelete(productEditable('product_images.product_id')),
    workerPolicy(),
  ],
).enableRLS()

/** One row per submission, so the review history is kept (design doc 5.5). */
export const productModeration = pgTable(
  'product_moderation',
  {
    id: uuidPrimaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    submittedAt: timestamptz('submitted_at').notNull().defaultNow(),
    aiFlags: jsonb('ai_flags')
      .$type<{ code: string; detail: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    aiRisk: text('ai_risk'),
    aiRequestId: uuid('ai_request_id').references(() => aiRequests.id),
    decision: text('decision'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamptz('decided_at'),
    // Shown to the seller on rejection.
    reason: text('reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('product_moderation_product_id_created_at_idx').on(
      t.productId,
      t.createdAt.desc(),
    ),
    // The administrator's review queue.
    index('product_moderation_open_created_at_idx')
      .on(t.createdAt)
      .where(sql`decision is null`),
    check(
      'product_moderation_ai_risk_check',
      sql`ai_risk in ('low', 'medium', 'high')`,
    ),
    check(
      'product_moderation_decision_check',
      sql`decision in ('approved', 'rejected')`,
    ),
    webSelect(
      sql`${fullAccess} or exists (select 1 from products p where p.id = product_moderation.product_id and p.seller_id = ${currentSellerId})`,
    ),
    webInsert(productEditable('product_moderation.product_id')),
    webUpdate(fullAccess),
    workerPolicy(),
  ],
).enableRLS()

/**
 * One text row per product and one image row per product image, all from the
 * same multimodal model, so text and photos share one index (design doc 5.5).
 * The dimension must match AI_EMBED_DIMENSIONS.
 */
export const productEmbeddings = pgTable(
  'product_embeddings',
  {
    id: uuidPrimaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    kind: text('kind').notNull(),
    imageId: uuid('image_id').references(() => productImages.id),
    model: text('model').notNull(),
    contentHash: text('content_hash').notNull(),
    embedding: vector('embedding', { dimensions: 1024 }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // NULLS NOT DISTINCT so a product can have only one text row.
    unique('product_embeddings_product_id_kind_image_id_key')
      .on(t.productId, t.kind, t.imageId)
      .nullsNotDistinct(),
    index('product_embeddings_text_hnsw_idx')
      .using('hnsw', t.embedding.op('vector_cosine_ops'))
      .where(sql`kind = 'text'`),
    index('product_embeddings_image_hnsw_idx')
      .using('hnsw', t.embedding.op('vector_cosine_ops'))
      .where(sql`kind = 'image'`),
    check('product_embeddings_kind_check', sql`kind in ('text', 'image')`),
    check(
      'product_embeddings_image_id_check',
      sql`(kind = 'image') = (image_id is not null)`,
    ),
    webSelect(productVisible('product_embeddings.product_id')),
    workerPolicy(),
  ],
).enableRLS()
