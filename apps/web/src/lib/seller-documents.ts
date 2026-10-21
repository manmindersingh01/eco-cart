import type { DocumentRequestView, DocumentToReview } from '@ecokart/core'

type JsonDates<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? JsonDates<U>[]
    : T extends object
      ? { [K in keyof T]: JsonDates<T[K]> }
      : T
export type SellerDocument = JsonDates<DocumentRequestView>
export type DocumentReview = JsonDates<DocumentToReview>
export type DocumentPage<T> = { items: T[]; nextCursor: string | null }

/** How each document type reads in a sentence, for example "Upload GST certificate". */
const DOCUMENT_TYPE_NAMES: Record<string, string> = {
  gst_certificate: 'GST certificate',
  pan_card: 'PAN card',
  bank_proof: 'bank proof',
  business_registration: 'business registration',
  address_proof: 'address proof',
  other: 'other document',
}

export const documentTypeName = (type: string): string =>
  DOCUMENT_TYPE_NAMES[type] ?? type

/** As a heading or option: GST certificate, Bank proof. */
export function documentTypeLabel(type: string): string {
  const name = documentTypeName(type)
  return name.charAt(0).toUpperCase() + name.slice(1)
}

export function documentUploadError(
  file: Pick<File, 'size' | 'type'>,
): string | null {
  if (file.size < 1 || file.size > 10 * 1024 * 1024)
    return 'Choose a file of up to 10 MB.'
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type))
    return 'Choose a PDF, JPEG or PNG file.'
  return null
}
