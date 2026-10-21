import type { BusinessFormValues } from './admin-sellers'
import type { SellerProfile, SellerStatus } from './seller-profile'

/** A buyer's application to sell: their own seller business. */
export type SellerApplication = SellerProfile

export type ApplicationFormValues = Omit<
  BusinessFormValues,
  'commissionPercent'
>

export const emptyApplication: ApplicationFormValues = {
  displayName: '',
  legalName: '',
  gstin: '',
  pan: '',
  line1: '',
  city: '',
  stateCode: '',
  pincode: '',
  supportEmail: '',
  supportPhone: '',
  invoicePrefix: '',
}

export function applicationValues(
  application: SellerApplication,
): ApplicationFormValues {
  return {
    displayName: application.displayName,
    legalName: application.legalName,
    gstin: application.gstin ?? '',
    pan: application.pan ?? '',
    line1: application.line1,
    city: application.city,
    stateCode: application.stateCode,
    pincode: application.pincode,
    supportEmail: application.supportEmail,
    supportPhone: application.supportPhone,
    invoicePrefix: application.invoicePrefix,
  }
}

const taxId = (value: string): string | null =>
  value.replaceAll(/\s+/g, '').toUpperCase() || null

/**
 * The body for applying or changing an application. Tax IDs and the
 * invoice prefix are written in capitals, and a blank invoice prefix is
 * left out so EcoKart suggests one from the display name.
 */
export function serialiseApplication(values: ApplicationFormValues) {
  const invoicePrefix = taxId(values.invoicePrefix)
  return {
    displayName: values.displayName.trim(),
    legalName: values.legalName.trim(),
    gstin: taxId(values.gstin),
    pan: taxId(values.pan),
    line1: values.line1.trim(),
    city: values.city.trim(),
    stateCode: values.stateCode,
    pincode: values.pincode.trim(),
    supportEmail: values.supportEmail.trim(),
    supportPhone: values.supportPhone.replaceAll(/\s+/g, ''),
    ...(invoicePrefix ? { invoicePrefix } : {}),
  }
}

export function applicationPresentation(status: SellerStatus): {
  label: string
  tone: 'success' | 'warning' | 'danger'
  title: string
  description: string
} {
  if (status === 'approved') {
    return {
      label: 'Approved',
      tone: 'success',
      title: 'You can now sell on EcoKart',
      description:
        'Open the seller portal to add your products. You still shop with the same account.',
    }
  }
  if (status === 'rejected') {
    return {
      label: 'Needs changes',
      tone: 'danger',
      title: 'Your application needs changes',
      description:
        'Read the reason below, correct your details, and apply again.',
    }
  }
  if (status === 'suspended') {
    return {
      label: 'Suspended',
      tone: 'danger',
      title: 'Your seller business is suspended',
      description:
        'Your products are not on EcoKart for now. Contact EcoKart support about the reason below. You can still shop as usual.',
    }
  }
  return {
    label: 'Waiting for review',
    tone: 'warning',
    title: 'Your application is waiting for review',
    description:
      'An EcoKart administrator will check your details. You can change them while you wait and upload any documents we ask for. You can keep shopping as usual.',
  }
}

export type DocumentRequestStatus =
  'requested' | 'processing' | 'received' | 'accepted' | 'cancelled'

export type DocumentFileStatus =
  'processing' | 'received' | 'failed' | 'accepted' | 'rejected'

export type DocumentFile = {
  id: string
  status: DocumentFileStatus
  contentType: string | null
  sizeBytes: number | null
  failureReason: string | null
  rejectionReason: string | null
  uploadedAt: string
  reviewedAt: string | null
}

export type DocumentRequest = {
  id: string
  sellerId: string
  type: string
  note: string
  status: DocumentRequestStatus
  requestedAt: string
  acceptedAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
  files: DocumentFile[]
}

export type DocumentUpload = {
  key: string
  url: string
  fields: Record<string, string>
  maxBytes: number
  expiresAt: string
}

export const DOCUMENT_TYPES = [
  { value: 'gst_certificate', label: 'GST certificate' },
  { value: 'pan_card', label: 'PAN card' },
  { value: 'bank_proof', label: 'Bank proof' },
  { value: 'business_registration', label: 'Business registration' },
  { value: 'address_proof', label: 'Address proof' },
  { value: 'other', label: 'Other document' },
] as const

export function documentTypeLabel(type: string): string {
  return DOCUMENT_TYPES.find((option) => option.value === type)?.label ?? type
}

const REQUEST_STATES: Record<
  DocumentRequestStatus,
  { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }
> = {
  requested: { label: 'Waiting for upload', tone: 'warning' },
  processing: { label: 'Checking file', tone: 'neutral' },
  received: { label: 'Waiting for review', tone: 'neutral' },
  accepted: { label: 'Accepted', tone: 'success' },
  cancelled: { label: 'Not needed', tone: 'neutral' },
}

export const documentRequestState = (status: DocumentRequestStatus) =>
  REQUEST_STATES[status]

/** The newest file's problem, shown when a request is back with the seller. */
export function latestFileProblem(request: DocumentRequest): string | null {
  const latest = request.files[0]
  if (!latest || request.status !== 'requested') return null
  if (latest.status === 'failed') {
    return latest.failureReason ?? 'The last file could not be read.'
  }
  if (latest.status === 'rejected') {
    return latest.rejectionReason ?? 'The last file was not accepted.'
  }
  return null
}

export const DOCUMENT_FILE_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024

export function validateDocumentFile(file: File): string | null {
  if (!DOCUMENT_FILE_TYPES.some((type) => type === file.type)) {
    return 'Use a PDF, JPEG, or PNG file.'
  }
  if (file.size < 1) return 'The file is empty.'
  if (file.size > MAX_DOCUMENT_BYTES)
    return 'The file must be 10 MB or smaller.'
  return null
}
