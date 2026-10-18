import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import type { Database } from '../../db/client.ts'
import {
  productModeration,
  productVariants,
  products,
} from '../../db/schema/index.ts'
import type { QueueDefinition } from '../../lib/queue.ts'
import { getSetting } from '../settings/service.ts'
import type { RiskLevel, ScreeningFlag } from './types.ts'

/*
 * Screening of a submitted listing (backend spec step 7, design doc 6.2
 * step 3). The worker runs it as soon as the seller submits: fixed checks
 * first, then (step 20) the AI checks, and the flags and the risk level go on
 * the review for the administrator.
 *
 * It loads no heavy library, so it is exported from @ecokart/core.
 */

export const SCREEN_LISTING_QUEUE = 'catalogue.screen-listing'

export const screeningQueues: QueueDefinition[] = [
  {
    name: SCREEN_LISTING_QUEUE,
    options: {
      retryLimit: 3,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 120,
      deleteAfterSeconds: 7 * 24 * 60 * 60,
    },
  },
]

export const screenListingJob = z.object({ reviewId: z.uuid() })

/** A price this far below its MRP, or further, usually means an inflated MRP. */
export const LARGE_DISCOUNT_BPS = 7000

/** Each kind of flag and how risky it makes a listing. */
const FLAG_RISK = {
  prohibited_term: 'high',
  large_discount: 'medium',
  missing_description: 'medium',
} as const satisfies Record<string, RiskLevel>

export type FlagCode = keyof typeof FLAG_RISK

const isFlagCode = (code: string): code is FlagCode =>
  Object.hasOwn(FLAG_RISK, code)

/** The highest risk among the flags; low when there are none. */
export function riskOf(flags: ScreeningFlag[]): RiskLevel {
  const risks = new Set(
    flags.map((flag) => {
      if (!isFlagCode(flag.code)) {
        throw new Error(`Screening flag ${flag.code} has no risk level`)
      }
      return FLAG_RISK[flag.code]
    }),
  )
  if (risks.has('high')) return 'high'
  if (risks.has('medium')) return 'medium'
  return 'low'
}

/**
 * Text in a form where whole words and phrases can be found: small letters,
 * and every run of characters that are not letters or digits (in any script)
 * turned into one space, with a space at each end. So "Toy-GUN, 2 pcs"
 * becomes " toy gun 2 pcs ".
 */
export function wordsOf(text: string): string {
  const words = text
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((word) => word.length > 0)
  return ` ${words.join(' ')} `
}

/** The seller's own text in a listing, by where it appears. */
export interface ListingText {
  title: string
  description: string
  highlights: string[]
  attributes: Record<string, string>
  optionNames: string[]
  /** The option values of every variant. */
  optionValues: string[]
}

const FIELD_NAMES: Record<keyof ListingText, string> = {
  title: 'the title',
  description: 'the description',
  highlights: 'the highlights',
  attributes: 'the attributes',
  optionNames: 'the option names',
  optionValues: 'the option values',
}

const fieldText = (listing: ListingText): [keyof ListingText, string][] => [
  ['title', listing.title],
  ['description', listing.description],
  ['highlights', listing.highlights.join('\n')],
  [
    'attributes',
    Object.entries(listing.attributes)
      .map(([name, value]) => `${name}\n${value}`)
      .join('\n'),
  ],
  ['optionNames', listing.optionNames.join('\n')],
  ['optionValues', listing.optionValues.join('\n')],
]

const joinNames = (names: string[]) =>
  names.length === 1
    ? names[0]!
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

/**
 * One flag for each prohibited term found as a whole word or phrase, saying
 * where, for example: "gun" appears in the title and the highlights.
 */
export function prohibitedTermFlags(
  listing: ListingText,
  terms: string[],
): ScreeningFlag[] {
  const fields = fieldText(listing).map(
    ([field, text]) => [field, wordsOf(text)] as const,
  )
  const flags: ScreeningFlag[] = []
  for (const term of terms) {
    const words = wordsOf(term)
    // A term of only punctuation can never match anything.
    if (words.trim() === '') continue
    const found = fields
      .filter(([, text]) => text.includes(words))
      .map(([field]) => FIELD_NAMES[field])
    if (found.length > 0) {
      flags.push({
        code: 'prohibited_term',
        detail: `"${term}" appears in ${joinNames(found)}`,
      })
    }
  }
  return flags
}

interface PricedVariant {
  sku: string
  pricePaise: number
  mrpPaise: number
}

/** How far below its MRP a price is, in basis points, rounded down. */
const discountBps = ({ pricePaise, mrpPaise }: PricedVariant) =>
  Math.floor(((mrpPaise - pricePaise) * 10_000) / mrpPaise)

/** One flag when any variant sells 70% or more below its MRP. */
export function largeDiscountFlags(variants: PricedVariant[]): ScreeningFlag[] {
  const large = variants
    .filter((variant) => discountBps(variant) >= LARGE_DISCOUNT_BPS)
    .toSorted((a, b) => discountBps(b) - discountBps(a))
  const [deepest] = large
  if (!deepest) return []
  const others = large.length - 1
  return [
    {
      code: 'large_discount',
      detail: `${deepest.sku} sells ${Math.floor(discountBps(deepest) / 100)}% below its MRP${
        others > 0
          ? `, and ${others} more variant${others === 1 ? '' : 's'} 70% or more below`
          : ''
      }`,
    },
  ]
}

/** The fixed checks, which need no AI (design doc 6.2 step 3). */
export function deterministicFlags(
  listing: ListingText,
  variants: PricedVariant[],
  prohibitedTerms: string[],
): ScreeningFlag[] {
  return [
    ...prohibitedTermFlags(listing, prohibitedTerms),
    ...largeDiscountFlags(variants),
    ...(listing.description.trim() === ''
      ? [{ code: 'missing_description', detail: 'The description is empty' }]
      : []),
  ]
}

export interface ScreeningDependencies {
  /** Connected as ecokart_worker. */
  db: Database
}

/**
 * Screens the listing of one review and stores the flags and the risk level
 * on it. A review that already has a decision is left alone, so a retry or a
 * late job never changes what an administrator decided.
 */
export async function screenListing(
  deps: ScreeningDependencies,
  reviewId: string,
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const [review] = await tx
      .select({
        productId: productModeration.productId,
        decision: productModeration.decision,
      })
      .from(productModeration)
      .where(eq(productModeration.id, reviewId))
    if (!review || review.decision !== null) return

    const [product] = await tx
      .select()
      .from(products)
      .where(eq(products.id, review.productId))
    if (!product) throw new Error(`Review ${reviewId} has no product`)
    const variants = await tx
      .select({
        sku: productVariants.sku,
        options: productVariants.options,
        pricePaise: productVariants.pricePaise,
        mrpPaise: productVariants.mrpPaise,
      })
      .from(productVariants)
      .where(eq(productVariants.productId, product.id))

    const flags = deterministicFlags(
      {
        title: product.title,
        description: product.description,
        highlights: product.highlights,
        attributes: product.attributes,
        optionNames: product.optionNames,
        optionValues: variants.flatMap((variant) =>
          Object.values(variant.options),
        ),
      },
      // Inactive variants too: a seller can switch one on without a review.
      variants,
      await getSetting(tx, 'prohibited_terms'),
    )
    // Step 20 (ai lane): ask the text model about the title and description
    // and the vision model about the photos here, after the fixed checks, add
    // their flags (with a risk level in FLAG_RISK), and set ai_request_id.

    await tx
      .update(productModeration)
      .set({ aiFlags: flags, aiRisk: riskOf(flags) })
      .where(
        and(
          eq(productModeration.id, reviewId),
          isNull(productModeration.decision),
        ),
      )
  })
}
