import type { ProductCard } from '../catalogue/storefront-types.ts'

/** One point of a comparison of two products. */
export interface ComparisonPoint {
  /** What is compared, for example "Capacity". */
  aspect: string
  /** About the first product. */
  first: string
  /** About the second product. */
  second: string
}

/**
 * The shopping assistant's answer (backend spec step 20, design doc 6.9).
 * The storefront shows `answer` as plain text and renders the products as
 * cards; nothing the model wrote is ever shown as HTML.
 */
export interface AssistantAnswer {
  answer: string
  /** True when the products here could not answer the question. */
  declined: boolean
  /** The products the answer names, best first. */
  products: ProductCard[]
  comparison: {
    products: [ProductCard, ProductCard]
    points: ComparisonPoint[]
  } | null
}
