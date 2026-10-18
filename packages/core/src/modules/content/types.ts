import { z } from 'zod'
import { strictObject, text } from '../../lib/validation.ts'

/** The pages the storefront links to, in its order. */
export const CONTENT_SLUGS = [
  'terms',
  'privacy',
  'shipping',
  'returns',
  'refunds',
  'seller-agreement',
] as const

export type ContentSlug = (typeof CONTENT_SLUGS)[number]

/** The title each page starts with. */
export const CONTENT_PAGES: Record<ContentSlug, string> = {
  terms: 'Terms of use',
  privacy: 'Privacy policy',
  shipping: 'Shipping policy',
  returns: 'Returns policy',
  refunds: 'Refund policy',
  'seller-agreement': 'Seller agreement',
}

export const CONTENT_STATUSES = ['draft', 'published'] as const
export type ContentStatus = (typeof CONTENT_STATUSES)[number]

/** Long enough for any policy; a page is never a book. */
export const MAX_CONTENT_LENGTH = 50_000

/** What an administrator sends to save a page. */
export const contentPageInput = strictObject({
  title: text(120),
  bodyMarkdown: z
    .string()
    .max(
      MAX_CONTENT_LENGTH,
      `must be at most ${MAX_CONTENT_LENGTH} characters`,
    ),
  status: z.enum(CONTENT_STATUSES, { error: 'must be draft or published' }),
})

/** A published page as visitors see it. Markdown, never HTML. */
export interface PublicContentPage {
  slug: ContentSlug
  title: string
  bodyMarkdown: string
  publishedAt: Date
  updatedAt: Date
}

/** A page as administrators see it, also before anyone has written it. */
export interface ContentPageView {
  slug: ContentSlug
  title: string
  bodyMarkdown: string
  status: ContentStatus
  /** False until the page is first saved. */
  saved: boolean
  publishedAt: Date | null
  updatedAt: Date | null
  updatedBy: string | null
}
