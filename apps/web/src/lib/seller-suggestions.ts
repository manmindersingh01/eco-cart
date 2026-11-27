import type { ListingSuggestion } from '@ecokart/core'
import type { ListingFormValues } from './product-editor'
import type { CatalogueImport } from './catalogue-operations'

export const listingSuggestionFields = [
  'title',
  'description',
  'highlights',
  'attributes',
] as const
export type SuggestionField = (typeof listingSuggestionFields)[number]

export function applyListingSuggestions(
  current: ListingFormValues,
  suggestion: ListingSuggestion,
  selected: Partial<Record<SuggestionField, boolean>>,
): ListingFormValues {
  return {
    ...current,
    ...(selected.title ? { title: suggestion.title } : {}),
    ...(selected.description ? { description: suggestion.description } : {}),
    ...(selected.highlights ? { highlights: [...suggestion.highlights] } : {}),
    ...(selected.attributes
      ? {
          attributes: Object.entries(suggestion.attributes).map(
            ([name, value]) => ({ name, value }),
          ),
        }
      : {}),
  }
}

export function importNeedsPolling(
  item: Pick<CatalogueImport, 'status' | 'suggestionPending'>,
): boolean {
  return (
    ['uploaded', 'mapping_confirmed', 'validating', 'importing'].includes(
      item.status,
    ) ||
    (item.status === 'mapping_suggested' && item.suggestionPending)
  )
}
