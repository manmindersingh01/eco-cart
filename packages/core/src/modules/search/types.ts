import type { ProductCard } from '../catalogue/storefront-types.ts'
import type { Page } from '../../lib/pagination.ts'

/** A page of keyword results (backend spec step 9). */
export interface SearchResult extends Page<ProductCard> {
  /**
   * `exact`: the words matched; `similar`: nothing matched the words, so
   * these are products with similar words, for example after a typo.
   */
  match: 'exact' | 'similar'
}

/** One line of the catalogue gap report. */
export interface SearchGap {
  /** The query in small letters, as searches are grouped. */
  query: string
  searches: number
  lastSearchedAt: Date
}
