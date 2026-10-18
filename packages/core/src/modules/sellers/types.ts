import { z } from 'zod'
import {
  email,
  gstin,
  indianMobile,
  pan,
  phoneNumber,
  pincode,
  stateCode,
  strictObject,
  text,
  wholeNumber,
} from '../../lib/validation.ts'

export type SellerStatus = 'pending' | 'approved' | 'suspended'

/** Details an administrator manages; they print on the seller's invoices. */
export const businessDetails = strictObject({
  displayName: text(100),
  legalName: text(200),
  gstin: gstin.nullable(),
  pan: pan.nullable(),
  line1: text(200),
  city: text(100),
  stateCode,
  pincode,
  supportEmail: email,
  supportPhone: phoneNumber,
  // At most 4, so an invoice number such as GRB/2627/000041 stays within the
  // 16 characters GST allows (backend spec step 14).
  invoicePrefix: z
    .string()
    .regex(/^[A-Z0-9]{1,4}$/, 'must be 1 to 4 capital letters or digits'),
  // Null uses the platform commission from settings.
  commissionBps: wholeNumber(0, 10_000).nullable(),
})
export type BusinessDetails = z.infer<typeof businessDetails>

export const newSeller = businessDetails.extend({
  // A seller can be created before its tax details are known; approval
  // needs them, and the platform commission applies without a rate.
  gstin: gstin.nullable().default(null),
  pan: pan.nullable().default(null),
  commissionBps: wholeNumber(0, 10_000).nullable().default(null),
  owner: strictObject({
    email,
    name: text(100),
    phoneNumber: indianMobile.nullable().default(null),
  }),
})
export type NewSeller = z.infer<typeof newSeller>

export const businessUpdate = businessDetails.partial()

/** The only details a seller may change about their own business. */
export const contactsUpdate = businessDetails
  .pick({ displayName: true, supportEmail: true, supportPhone: true })
  .partial()

export const suspension = strictObject({ reason: text(500) })

/**
 * Rules that span fields: the PAN sits inside the GSTIN, and a GSTIN starts
 * with the state code of the business it belongs to.
 */
export function taxIdIssues(details: {
  gstin: string | null
  pan: string | null
  stateCode: string
}): string[] {
  const issues: string[] = []
  if (
    details.gstin &&
    details.pan &&
    details.gstin.slice(2, 12) !== details.pan
  ) {
    issues.push('gstin must contain the PAN as its 3rd to 12th characters')
  }
  if (details.gstin && details.gstin.slice(0, 2) !== details.stateCode) {
    issues.push(
      `gstin must start with the state code of the address (${details.stateCode})`,
    )
  }
  return issues
}

/** A seller as the admin console and the seller portal show it. */
export interface SellerView {
  id: string
  slug: string
  ownerUserId: string
  status: SellerStatus
  displayName: string
  legalName: string
  gstin: string | null
  pan: string | null
  line1: string
  city: string
  stateCode: string
  pincode: string
  supportEmail: string
  supportPhone: string
  invoicePrefix: string
  commissionBps: number | null
  approvedAt: Date | null
  suspendedReason: string | null
  createdAt: Date
  updatedAt: Date
}

/* Verification documents (design doc 5.4). */

export const DOCUMENT_TYPES = [
  'gst_certificate',
  'pan_card',
  'bank_proof',
  'business_registration',
  'address_proof',
  'other',
] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export const isDocumentType = (value: string): value is DocumentType =>
  DOCUMENT_TYPES.some((type) => type === value)

/** How messages name each type. */
const DOCUMENT_TYPE_NAMES: Record<DocumentType, string> = {
  gst_certificate: 'GST certificate',
  pan_card: 'PAN card',
  bank_proof: 'bank proof',
  business_registration: 'business registration',
  address_proof: 'address proof',
  other: 'other document',
}

export const documentTypeName = (type: string): string =>
  isDocumentType(type) ? DOCUMENT_TYPE_NAMES[type] : type

/** The file types a seller may upload, as browsers name them. */
export const DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const
export type DocumentContentType = (typeof DOCUMENT_CONTENT_TYPES)[number]

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024

export const MAX_DOCUMENTS_PER_REQUEST = 10

/**
 * - requested: waiting for the seller's file, also after a file failed the
 *   check or was rejected.
 * - processing: the worker is checking the file.
 * - received: the file passed the check and waits for an administrator.
 */
export type DocumentRequestStatus =
  'requested' | 'processing' | 'received' | 'accepted' | 'cancelled'

/** Requests that still stand in the way of approval. */
export const OPEN_DOCUMENT_STATUSES: DocumentRequestStatus[] = [
  'requested',
  'processing',
  'received',
]

export type DocumentFileStatus =
  'processing' | 'received' | 'failed' | 'accepted' | 'rejected'

export const documentRequests = strictObject({
  documents: z
    .array(
      strictObject({
        type: z.enum(DOCUMENT_TYPES),
        note: text(500),
      }),
    )
    .min(1, 'must list at least one document')
    .max(
      MAX_DOCUMENTS_PER_REQUEST,
      `must list at most ${MAX_DOCUMENTS_PER_REQUEST} documents`,
    ),
})

export const documentRejection = strictObject({ reason: text(500) })

export const documentCancellation = strictObject({ reason: text(500) })

export const documentUploadRequest = strictObject({
  contentType: z.enum(DOCUMENT_CONTENT_TYPES, {
    error: (issue) =>
      issue.input === undefined
        ? undefined
        : 'must be application/pdf, image/jpeg, or image/png',
  }),
  /** In bytes. */
  size: z
    .number()
    .int('must be a whole number')
    .min(1, 'must be at least 1 byte')
    .max(MAX_DOCUMENT_BYTES, 'must be at most 10 MB'),
})

export const newDocumentFile = strictObject({ uploadKey: z.string() })

/** One uploaded file, with the worker's check and the review. */
export interface DocumentFileView {
  id: string
  status: DocumentFileStatus
  /** The type the bytes really are, once checked. */
  contentType: DocumentContentType | null
  sizeBytes: number | null
  /** Why the file could not be used, when it failed the check. */
  failureReason: string | null
  /** Why an administrator rejected it. */
  rejectionReason: string | null
  uploadedAt: Date
  reviewedAt: Date | null
}

/** A document request with every file sent for it, newest first. */
export interface DocumentRequestView {
  id: string
  sellerId: string
  type: DocumentType
  note: string
  status: DocumentRequestStatus
  requestedAt: Date
  acceptedAt: Date | null
  cancelledAt: Date | null
  /** Why an administrator cancelled it; the seller sees it. */
  cancelReason: string | null
  files: DocumentFileView[]
}

/** A file waiting for review, in the administrators' queue. */
export interface DocumentToReview {
  request: DocumentRequestView
  seller: { id: string; displayName: string; status: SellerStatus }
  fileId: string
  uploadedAt: Date
}

export interface DocumentUpload {
  /** Pass back as `uploadKey` once the file is uploaded. */
  key: string
  url: string
  fields: Record<string, string>
  maxBytes: number
  expiresAt: Date
}

export interface DocumentDownload {
  /** A signed link to the file; it stops working at `expiresAt`. */
  url: string
  expiresAt: Date
  fileName: string
}
