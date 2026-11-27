import type { AssistantAnswer, ProductCard } from '@ecokart/core'
import { expect, test } from 'vitest'
import {
  assistantCards,
  assistantHistory,
  formatAiCost,
  namedProductIds,
} from './assistant-report'

const card: ProductCard = {
  id: 'server-card',
  slug: 'server-product',
  title: 'Server product',
  brand: null,
  minPricePaise: 10000,
  maxPricePaise: 10000,
  minMrpPaise: 12000,
  inStock: true,
  ratingAvg: 0,
  ratingCount: 0,
  minOrderQuantity: 1,
  image: null,
}
const answer: AssistantAnswer = {
  answer: 'Known facts',
  products: [card],
  comparison: null,
  declined: false,
}
test('assistant history and named products stay within the service bounds', () => {
  const turns = Array.from({ length: 5 }, (_, index) => ({
    question: `Question ${index}`,
    answer: { ...answer, answer: 'x'.repeat(1600) },
  }))
  const history = assistantHistory(turns)
  expect(history).toHaveLength(6)
  expect(history[0]).toEqual({ from: 'shopper', text: 'Question 2' })
  expect(history.every((turn) => turn.text.length <= 1500)).toBe(true)
  expect(namedProductIds(['1', '1', '2', '3', '4', '5', '6'])).toEqual([
    '1',
    '2',
    '3',
    '4',
    '5',
  ])
})
test('cited cards come only from server card fields, never raw product ids or answer text', () => {
  const reply = {
    ...answer,
    products: [],
    answer: 'invented-product',
    productIds: ['invented-product'],
  }
  expect(assistantCards(reply)).toEqual([])
  expect(
    assistantCards({
      ...answer,
      products: [card, card],
      comparison: { products: [card, { ...card, id: 'second' }], points: [] },
    }),
  ).toHaveLength(2)
})
test('micro-USD costs retain all six decimals and distinguish unknown from zero', () => {
  expect(formatAiCost(1234567)).toBe('USD 1.234567')
  expect(formatAiCost(1)).toBe('USD 0.000001')
  expect(formatAiCost(0)).toBe('USD 0.000000')
  expect(formatAiCost(null)).toBe('Not reported')
  expect(formatAiCost(1000000123456)).toBe('USD 10,00,000.123456')
})
