import {
  clientAddress,
  consumeSearchAllowance,
  searchProducts,
  TooManyRequestsError,
  ValidationError,
  withContext,
} from '@ecokart/core'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { Suspense } from 'react'
import { ListingControls } from '@/components/storefront/listing-controls'
import { ListingPager } from '@/components/storefront/listing-pager'
import { ProductGrid } from '@/components/storefront/product-card'
import { SearchBox } from '@/components/storefront/search-box'
import { LinkButton } from '@/components/ui/button'
import { EmptyState, Notice } from '@/components/ui/feedback'
import { ContentLoading } from '@/components/ui/page-loading'
import { getDatabase } from '@/lib/db'
import { getPublicBrands } from '@/lib/public-catalogue'
import { getStorage } from '@/lib/storage'
import {
  LIST_SORTS,
  listingQuery,
  queryRecord,
} from '@/lib/storefront-display'

export const metadata: Metadata = {
  title: 'Search',
  robots: { index: false },
}

const SEARCH_SORTS = [
  { value: 'relevance', label: 'Best match' },
  ...LIST_SORTS,
]

export default function SearchPage(props: PageProps<'/search'>) {
  return (
    <main id="main-content" className="page-container flex-1 py-8 sm:py-10">
      <div className="grid gap-6">
        <h1 className="text-3xl font-semibold tracking-tight">Search</h1>
        {/* Keyword search is never cached: each search is logged for the
            catalogue gap report and limited per address. Natural-language
            and photo search come with the AI features and sit beside it. */}
        <Suspense fallback={<ContentLoading />}>
          <SearchResults {...props} />
        </Suspense>
      </div>
    </main>
  )
}

async function SearchResults({ searchParams }: PageProps<'/search'>) {
  const query = listingQuery(await searchParams)
  const keyword = query.q ?? ''
  if (!keyword) {
    return (
      <>
        <SearchBox defaultValue="" />
        <EmptyState
          title="What are you looking for?"
          description="Search by product name, brand, or what it is made of, for example bamboo toothbrush."
        />
      </>
    )
  }

  const requestHeaders = await headers()
  const db = getDatabase()
  let result
  try {
    // Its own transaction, so the count's row lock is released at once.
    await withContext(db, { role: 'anonymous' }, (tx) =>
      consumeSearchAllowance(tx, clientAddress(requestHeaders)),
    )
    result = await withContext(db, { role: 'anonymous' }, (tx) =>
      searchProducts(tx, getStorage(), queryRecord(query)),
    )
  } catch (cause) {
    if (cause instanceof TooManyRequestsError) {
      return (
        <>
          <SearchBox defaultValue={keyword} />
          <Notice tone="warning" title="Too many searches for a moment">
            Wait a minute, then search again.
          </Notice>
        </>
      )
    }
    if (cause instanceof ValidationError) {
      return (
        <>
          <SearchBox defaultValue={keyword} />
          <Notice tone="danger" title="This search could not be used">
            <ul className="list-disc pl-5">
              {cause.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
            <LinkButton
              href={`/search?${new URLSearchParams({ q: keyword }).toString()}`}
              variant="secondary"
              className="mt-3"
            >
              Search again without filters
            </LinkButton>
          </Notice>
        </>
      )
    }
    throw cause
  }
  const brands = await getPublicBrands({ limit: 100 })

  return (
    <>
      <SearchBox defaultValue={keyword} />
      {result.match === 'similar' && result.items.length ? (
        <Notice tone="neutral" title={`No exact matches for “${keyword}”`}>
          These products have similar words, which may be what you meant.
        </Notice>
      ) : null}
      <ListingControls
        path="/search"
        query={query}
        brands={brands.items}
        sorts={SEARCH_SORTS}
        defaultSort="relevance"
      />
      {result.items.length ? (
        <ProductGrid products={result.items} priority={4} />
      ) : (
        <EmptyState
          title={
            query.cursor ? 'No more results' : `Nothing found for “${keyword}”`
          }
          description={
            query.cursor
              ? 'You have reached the end of these results.'
              : 'Check the spelling, try a shorter word, or clear the filters.'
          }
        />
      )}
      <ListingPager
        path="/search"
        query={query}
        nextCursor={result.nextCursor}
      />
    </>
  )
}
