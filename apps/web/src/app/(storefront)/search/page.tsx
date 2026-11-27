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
import { LinkButton } from '@/components/ui/button'
import { EmptyState, Notice } from '@/components/ui/feedback'
import { ContentLoading } from '@/components/ui/page-loading'
import { getDatabase } from '@/lib/db'
import { getPublicBrands } from '@/lib/public-catalogue'
import { getStorage } from '@/lib/storage'
import { LIST_SORTS, listingQuery, queryRecord } from '@/lib/storefront-display'
import { DiscoverySearch } from '@/components/storefront/discovery-search'
import { ShoppingAssistant } from '@/components/storefront/shopping-assistant'

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
      {/* Keyword search is never cached: each search is logged for the
          catalogue gap report and limited per address. The words are typed
          in the header's search box, which keeps them on this page. */}
      <Suspense fallback={<ContentLoading />}>
        <div className="grid gap-6">
          <SearchWorkspace {...props} />
        </div>
      </Suspense>
    </main>
  )
}

async function SearchWorkspace({ searchParams }: PageProps<'/search'>) {
  const raw = await searchParams
  const value = (key: string) =>
    Array.isArray(raw[key]) ? raw[key].at(-1) : raw[key]
  const mode = value('mode') ?? 'keyword'
  const query = listingQuery(raw)
  const initial = {
    ...query,
    ...(value('category') ? { category: value('category') } : {}),
  }
  return (
    <>
      <nav aria-label="Search mode" className="flex flex-wrap gap-3">
        <LinkButton
          variant={mode === 'keyword' ? 'primary' : 'secondary'}
          aria-current={mode === 'keyword' ? 'page' : undefined}
          href={{ pathname: '/search', query: query.q ? { q: query.q } : {} }}
        >
          Keyword
        </LinkButton>
        <LinkButton
          variant={mode === 'natural' ? 'primary' : 'secondary'}
          aria-current={mode === 'natural' ? 'page' : undefined}
          href={{
            pathname: '/search',
            query: { mode: 'natural', ...(query.q ? { q: query.q } : {}) },
          }}
        >
          Natural language
        </LinkButton>
        <LinkButton
          variant={mode === 'photo' ? 'primary' : 'secondary'}
          aria-current={mode === 'photo' ? 'page' : undefined}
          href="/search?mode=photo"
        >
          Photo
        </LinkButton>
      </nav>
      {mode === 'keyword' ? (
        <SearchResults searchParams={Promise.resolve(raw)} />
      ) : mode === 'natural' || mode === 'photo' ? (
        <DiscoverySearch
          key={mode === 'natural' ? JSON.stringify(initial) : mode}
          mode={mode}
          initial={initial}
          brands={(await getPublicBrands({ limit: 100 })).items}
        />
      ) : (
        <>
          <h1 className="text-3xl font-semibold">Search</h1>
          <Notice tone="danger" title="Choose a search mode">
            Use Keyword, Natural language or Photo above.
          </Notice>
        </>
      )}
    </>
  )
}

async function SearchResults({
  searchParams,
}: Pick<PageProps<'/search'>, 'searchParams'>) {
  const query = listingQuery(await searchParams)
  const keyword = query.q ?? ''
  if (!keyword) {
    return (
      <>
        <h1 className="text-3xl font-semibold tracking-tight">Search</h1>
        <EmptyState
          title="What are you looking for?"
          description="Type in the search box at the top: a product name, a brand, or what it is made of, for example bamboo toothbrush."
        />
        <ShoppingAssistant productIds={[]} />
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
          <ResultsHeading keyword={keyword} />
          <Notice tone="warning" title="Too many searches for a moment">
            Wait a minute, then search again.
          </Notice>
        </>
      )
    }
    if (cause instanceof ValidationError) {
      return (
        <>
          <ResultsHeading keyword={keyword} />
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
      <ResultsHeading keyword={keyword} />
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
      <ShoppingAssistant
        key={result.items
          .map((item) => item.id)
          .slice(0, 5)
          .join(',')}
        productIds={result.items.map((item) => item.id)}
      />
    </>
  )
}

function ResultsHeading({ keyword }: { keyword: string }) {
  return (
    <h1 className="text-2xl font-semibold tracking-tight break-words sm:text-3xl">
      Results for “{keyword}”
    </h1>
  )
}
