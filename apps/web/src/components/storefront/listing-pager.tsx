import { LinkButton } from '@/components/ui/button'
import { listingHref, type ListingQuery } from '@/lib/storefront-display'

/**
 * Keyset pages: Next continues from the cursor the list gave, and the first
 * page drops it. Going back a page is the browser's Back, which keeps the
 * address of each page.
 */
export function ListingPager({
  path,
  query,
  nextCursor,
}: {
  path: `/categories/${string}` | '/search'
  query: ListingQuery
  nextCursor: string | null
}) {
  if (!nextCursor && !query.cursor) return null
  return (
    <nav
      aria-label="More products"
      className="flex flex-wrap items-center justify-center gap-3"
    >
      {query.cursor ? (
        <LinkButton href={listingHref(path, query, {})} variant="secondary">
          Back to the first page
        </LinkButton>
      ) : null}
      {nextCursor ? (
        <LinkButton href={listingHref(path, query, { cursor: nextCursor })}>
          Next page
        </LinkButton>
      ) : null}
    </nav>
  )
}
