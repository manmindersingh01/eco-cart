import type { AssistantAnswer, ProductCard } from '@ecokart/core'

export type AssistantTurn = { question: string; answer: AssistantAnswer }
export function assistantHistory(
  turns: readonly AssistantTurn[],
): { from: 'shopper' | 'assistant'; text: string }[] {
  return turns
    .flatMap((turn) => [
      { from: 'shopper' as const, text: turn.question.slice(0, 1500) },
      { from: 'assistant' as const, text: turn.answer.answer.slice(0, 1500) },
    ])
    .slice(-6)
}
export function namedProductIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].slice(0, 5)
}
export function assistantCards(answer: AssistantAnswer): ProductCard[] {
  const cards = [...answer.products, ...(answer.comparison?.products ?? [])]
  return [...new Map(cards.map((card) => [card.id, card])).values()]
}
export function formatAiCost(costMicroUsd: number | null): string {
  if (costMicroUsd === null) return 'Not reported'
  const amount = BigInt(costMicroUsd)
  return `USD ${(amount / 1000000n).toLocaleString('en-IN')}.${String(amount % 1000000n).padStart(6, '0')}`
}
