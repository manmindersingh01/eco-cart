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

export function documentUploadError(
  file: Pick<File, 'size' | 'type'>,
): string | null {
  if (file.size < 1 || file.size > 10 * 1024 * 1024)
    return 'Choose a non-empty file of at most 10 MB (10,485,760 bytes).'
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type))
    return 'Choose a PDF, JPEG or PNG file.'
  return null
}
