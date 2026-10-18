import { sql } from 'drizzle-orm'
import {
  char,
  check,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { users } from './auth.ts'
import { createdAt, timestamptz, updatedAt, uuidPrimaryKey } from './columns.ts'
import {
  currentSellerId,
  currentUserId,
  fullAccess,
  webInsert,
  webSelect,
  webRole,
  webUpdate,
  workerPolicy,
} from './rls.ts'

/** A seller business, owned by one seller account (design doc 5.4). */
export const sellers = pgTable(
  'sellers',
  {
    id: uuidPrimaryKey(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .unique()
      .references(() => users.id),
    slug: text('slug').notNull().unique(),
    displayName: text('display_name').notNull(),
    legalName: text('legal_name').notNull(),
    gstin: text('gstin'),
    pan: text('pan'),
    line1: text('line1').notNull(),
    city: text('city').notNull(),
    stateCode: char('state_code', { length: 2 }).notNull(),
    pincode: char('pincode', { length: 6 }).notNull(),
    supportEmail: text('support_email').notNull(),
    supportPhone: text('support_phone').notNull(),
    // Overrides the platform default commission when set.
    commissionBps: integer('commission_bps'),
    // Invoice numbers must be unique across the platform, so prefixes are too.
    invoicePrefix: text('invoice_prefix').notNull().unique(),
    invoiceSeq: integer('invoice_seq').notNull().default(0),
    invoiceSeqFy: text('invoice_seq_fy'),
    status: text('status').notNull().default('pending'),
    approvedAt: timestamptz('approved_at'),
    suspendedReason: text('suspended_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // The administrators' seller list: newest first, optionally by status.
    index('sellers_status_created_at_idx').on(
      t.status,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index('sellers_created_at_idx').on(t.createdAt.desc(), t.id.desc()),
    check(
      'sellers_status_check',
      sql`status in ('pending', 'approved', 'suspended')`,
    ),
    check(
      'sellers_gstin_check',
      sql`gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`,
    ),
    check('sellers_pan_check', sql`pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'`),
    check('sellers_state_code_check', sql`state_code ~ '^[0-9]{2}$'`),
    check('sellers_pincode_check', sql`pincode ~ '^[1-9][0-9]{5}$'`),
    check(
      'sellers_support_phone_check',
      sql`support_phone ~ '^\\+[1-9][0-9]{7,14}$'`,
    ),
    check(
      'sellers_commission_bps_check',
      sql`commission_bps between 0 and 10000`,
    ),
    // At most 4, so an invoice number such as GRB/2627/000041 fits the 16
    // characters GST allows (backend spec step 14).
    check(
      'sellers_invoice_prefix_check',
      sql`invoice_prefix ~ '^[A-Z0-9]{1,4}$'`,
    ),
    check('sellers_invoice_seq_check', sql`invoice_seq >= 0`),
    // Every sale needs a GST invoice, so a seller who was ever approved
    // keeps their tax details (backend spec step 14).
    check(
      'sellers_tax_ids_after_approval_check',
      sql`approved_at is null or (gstin is not null and pan is not null)`,
    ),
    check(
      'sellers_invoice_seq_fy_check',
      sql`invoice_seq_fy ~ '^[0-9]{4}-[0-9]{2}$'`,
    ),
    webSelect(
      sql`status = 'approved' or owner_user_id = ${currentUserId} or id = ${currentSellerId} or ${fullAccess}`,
    ),
    webInsert(fullAccess),
    webUpdate(sql`id = ${currentSellerId} or ${fullAccess}`),
    workerPolicy(),
  ],
).enableRLS()

/**
 * A document an administrator asks a seller for, to verify them before
 * approval or to check an approved seller again (design doc 5.4).
 */
export const sellerDocumentRequests = pgTable(
  'seller_document_requests',
  {
    id: uuidPrimaryKey(),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => sellers.id),
    documentType: text('document_type').notNull(),
    // What the seller must send, in the administrator's words.
    note: text('note').notNull(),
    status: text('status').notNull().default('requested'),
    requestedBy: uuid('requested_by').references(() => users.id),
    acceptedAt: timestamptz('accepted_at'),
    acceptedBy: uuid('accepted_by').references(() => users.id),
    cancelledAt: timestamptz('cancelled_at'),
    cancelledBy: uuid('cancelled_by').references(() => users.id),
    cancelReason: text('cancel_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One seller's requests, newest first, for the seller and administrators.
    index('seller_document_requests_seller_id_created_at_idx').on(
      t.sellerId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    check(
      'seller_document_requests_status_check',
      sql`status in ('requested', 'processing', 'received', 'accepted', 'cancelled')`,
    ),
    check(
      'seller_document_requests_document_type_check',
      sql`document_type in ('gst_certificate', 'pan_card', 'bank_proof', 'business_registration', 'address_proof', 'other')`,
    ),
    check(
      'seller_document_requests_note_check',
      sql`char_length(note) between 1 and 500`,
    ),
    check(
      'seller_document_requests_accepted_check',
      sql`(status = 'accepted') = (accepted_at is not null)`,
    ),
    check(
      'seller_document_requests_cancelled_check',
      sql`(status = 'cancelled') = (cancelled_at is not null) and (cancelled_at is null) = (cancel_reason is null)`,
    ),
    webSelect(sql`seller_id = ${currentSellerId} or ${fullAccess}`),
    webInsert(fullAccess),
    // A seller only ever moves their own request on to processing, by
    // uploading a file for it.
    pgPolicy('web_update', {
      for: 'update',
      to: webRole,
      using: sql`seller_id = ${currentSellerId} or ${fullAccess}`,
      withCheck: sql`${fullAccess} or (seller_id = ${currentSellerId} and status = 'processing')`,
    }),
    workerPolicy(),
  ],
).enableRLS()

/**
 * Each file a seller uploads for a document request, kept with the worker's
 * check and the administrator's decision, so the request keeps its history.
 */
export const sellerDocumentFiles = pgTable(
  'seller_document_files',
  {
    id: uuidPrimaryKey(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => sellerDocumentRequests.id),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => sellers.id),
    // The file as the browser sent it, read only by the worker.
    uploadKey: text('upload_key').notNull().unique(),
    // The checked copy, set once the worker accepts the file.
    storageKey: text('storage_key'),
    status: text('status').notNull().default('processing'),
    // The type the bytes really are, whatever the browser claimed.
    contentType: text('content_type'),
    sizeBytes: integer('size_bytes'),
    contentHash: text('content_hash'),
    failureReason: text('failure_reason'),
    rejectionReason: text('rejection_reason'),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    reviewedAt: timestamptz('reviewed_at'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('seller_document_files_request_id_created_at_idx').on(
      t.requestId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    // The administrators' review queue: checked files, oldest first.
    index('seller_document_files_received_idx')
      .on(t.createdAt, t.id)
      .where(sql`status = 'received'`),
    // A request has at most one file being checked or waiting for review.
    uniqueIndex('seller_document_files_live_request_id_unique')
      .on(t.requestId)
      .where(sql`status in ('processing', 'received')`),
    check(
      'seller_document_files_status_check',
      sql`status in ('processing', 'received', 'failed', 'accepted', 'rejected')`,
    ),
    check(
      'seller_document_files_content_type_check',
      sql`content_type in ('application/pdf', 'image/jpeg', 'image/png')`,
    ),
    check(
      'seller_document_files_checked_check',
      sql`(status in ('received', 'accepted', 'rejected')) = (storage_key is not null and content_type is not null and size_bytes is not null and content_hash is not null)`,
    ),
    check(
      'seller_document_files_failure_check',
      sql`(status = 'failed') = (failure_reason is not null)`,
    ),
    check(
      'seller_document_files_rejection_check',
      sql`(status = 'rejected') = (rejection_reason is not null)`,
    ),
    check(
      'seller_document_files_reviewed_check',
      sql`(status in ('accepted', 'rejected')) = (reviewed_at is not null)`,
    ),
    webSelect(sql`seller_id = ${currentSellerId} or ${fullAccess}`),
    // A seller adds files to their own requests only, as unchecked uploads.
    webInsert(
      sql`${fullAccess} or (seller_id = ${currentSellerId} and uploaded_by = ${currentUserId} and status = 'processing' and exists (select 1 from seller_document_requests r where r.id = seller_document_files.request_id and r.seller_id = ${currentSellerId}))`,
    ),
    webUpdate(fullAccess),
    workerPolicy(),
  ],
).enableRLS()
