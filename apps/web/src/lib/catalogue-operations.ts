import type {
  ImportView,
  ImportSummary,
  ProductForReview,
  ReviewQueueItem,
} from '@ecokart/core'
import { signedUploadBody } from './product-editor'

export type JsonDates<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? JsonDates<U>[]
    : T extends object
      ? { [K in keyof T]: JsonDates<T[K]> }
      : T
export type CatalogueImport = JsonDates<ImportView>
export type CatalogueImportSummary = JsonDates<ImportSummary>
export type ListingReview = JsonDates<ProductForReview>
export type QueueItem = JsonDates<ReviewQueueItem>
export type UploadForm = {
  key: string
  url: string
  fields: Record<string, string>
  maxBytes: number
}

/** Only an explicitly expired/refused form is safe to renew automatically. */
export async function uploadCatalogueFile(
  file: File,
  sign: () => Promise<UploadForm>,
): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const form = await sign()
    if (file.size > form.maxBytes)
      throw new Error('The file exceeds the server upload limit.')
    const response = await fetch(form.url, {
      method: 'POST',
      body: signedUploadBody(form.fields, file),
    })
    if (response.ok) return form.key
    if (response.status !== 403 || attempt === 1)
      throw new Error(
        'Storage refused the upload. Choose the file again to retry.',
      )
  }
  throw new Error('The upload form expired. Choose the file again.')
}

export function minimumQuantity(value: string): number {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 1000)
    throw new Error('Minimum quantity must be a whole number from 1 to 1000.')
  return Number(value)
}

export function mappingInput(
  mapping: Record<string, string>,
  fields: CatalogueImport['fields'],
): Record<string, string> {
  const entries = Object.entries(mapping).filter(([, field]) => field !== '')
  const chosen = entries.map(([, field]) => field)
  if (new Set(chosen).size !== chosen.length)
    throw new Error('Map each EcoKart field once.')
  for (const field of fields)
    if (field.required && !chosen.includes(field.field))
      throw new Error(`Choose a column for ${field.label}.`)
  return Object.fromEntries(entries)
}
