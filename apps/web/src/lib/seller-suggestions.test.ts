import { expect, test } from 'vitest'
import {
  applyListingSuggestions,
  importNeedsPolling,
} from './seller-suggestions'
import type { ListingFormValues } from './product-editor'

const form: ListingFormValues = {
  categoryId: 'chosen-category',
  brandId: 'chosen-brand',
  title: 'My unsaved title',
  description: 'My unsaved description',
  highlights: ['My highlight'],
  attributes: [{ name: 'Colour', value: 'Green' }],
  hsnCode: '4419',
  optionNames: ['Size'],
}
const suggestion = {
  title: 'Suggested title',
  description: 'Suggested description',
  highlights: ['Suggested highlight'],
  attributes: { Material: 'Bamboo' },
}

test('applying selected fields preserves all other current unsaved values', () => {
  expect(
    applyListingSuggestions(form, suggestion, { description: true }),
  ).toEqual({ ...form, description: suggestion.description })
  expect(applyListingSuggestions(form, suggestion, {})).toEqual(form)
})
test('selected collections are copied without sharing mutable suggestion arrays', () => {
  const changed = applyListingSuggestions(form, suggestion, {
    highlights: true,
    attributes: true,
  })
  expect(changed.attributes).toEqual([{ name: 'Material', value: 'Bamboo' }])
  changed.highlights.push('My later edit')
  expect(suggestion.highlights).toEqual(['Suggested highlight'])
  expect(form.highlights).toEqual(['My highlight'])
})
test('mapping polling continues only while suggestions or import work remain pending', () => {
  expect(
    importNeedsPolling({
      status: 'mapping_suggested',
      suggestionPending: true,
    }),
  ).toBe(true)
  expect(
    importNeedsPolling({
      status: 'mapping_suggested',
      suggestionPending: false,
    }),
  ).toBe(false)
  expect(
    importNeedsPolling({ status: 'importing', suggestionPending: false }),
  ).toBe(true)
  expect(
    importNeedsPolling({ status: 'completed', suggestionPending: true }),
  ).toBe(false)
  expect(
    importNeedsPolling({ status: 'failed', suggestionPending: true }),
  ).toBe(false)
})
