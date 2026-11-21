import { NotFoundError, ValidationError } from '@ecokart/core'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { Breadcrumbs } from '@/components/storefront/breadcrumbs'
import { ListingControls } from '@/components/storefront/listing-controls'
import { ListingPager } from '@/components/storefront/listing-pager'
import { ProductGrid } from '@/components/storefront/product-card'
import { LinkButton } from '@/components/ui/button'
import { EmptyState, Notice } from '@/components/ui/feedback'
import { ContentLoading } from '@/components/ui/page-loading'
import { getPublicBrands } from '@/lib/public-catalogue'
import { readCategoryPage } from '@/lib/storefront'
import { listingQuery, queryRecord } from '@/lib/storefront-display'

export async function generateMetadata({
  params,
}: PageProps<'/categories/[slug]'>): Promise<Metadata> {
  const { slug } = await params
  try {
    const page = await readCategoryPage(slug, {})
    return {
      title: page.category.name,
      description: `Shop ${page.category.name} from independent sellers across India on EcoKart.`,
      alternates: { canonical: `/categories/${slug}` },
    }
  } catch (cause) {
    if (cause instanceof NotFoundError) return { title: 'Category not found' }
    throw cause
  }
}

export default function CategoryPage(props: PageProps<'/categories/[slug]'>) {
  return (
    <main id="main-content" className="page-container flex-1 py-8 sm:py-10">
      {/* The address and its query are read per request, inside the boundary;
          the products come from the cached storefront read. */}
      <Suspense fallback={<ContentLoading />}>
        <CategoryContent {...props} />
      </Suspense>
    </main>
  )
}

async function CategoryContent({
  params,
  searchParams,
}: PageProps<'/categories/[slug]'>) {
  const { slug } = await params
  const query = listingQuery(await searchParams)
  // A category page has no keyword; search is its own page.
  delete query.q
  const path = `/categories/${slug}` as const
  let page
  try {
    page = await readCategoryPage(slug, queryRecord(query))
  } catch (cause) {
    if (cause instanceof NotFoundError) notFound()
    if (cause instanceof ValidationError) {
      return (
        <Notice tone="danger" title="These filters could not be used">
          <ul className="list-disc pl-5">
            {cause.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
          <LinkButton href={path} variant="secondary" className="mt-3">
            Show every product in this category
          </LinkButton>
        </Notice>
      )
    }
    throw cause
  }
  const brands = await getPublicBrands({ limit: 100 })
  const { category } = page

  return (
    <div className="grid gap-6">
      <Breadcrumbs trail={category.breadcrumbs} currentId={category.id} />
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          {category.name}
        </h1>
        {category.children.length ? (
          <nav aria-label={`Inside ${category.name}`} className="mt-4">
            <ul className="flex flex-wrap gap-2">
              {category.children.map((child) => (
                <li key={child.id}>
                  <Link
                    href={`/categories/${child.slug}`}
                    className="inline-flex min-h-11 items-center rounded-full border bg-surface px-4 text-sm font-medium hover:border-brand hover:text-brand-strong"
                  >
                    {child.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
      <ListingControls path={path} query={query} brands={brands.items} />
      {page.items.length ? (
        <ProductGrid products={page.items} priority={4} />
      ) : (
        <EmptyState
          title={
            query.cursor
              ? 'No more products'
              : 'No products match these filters'
          }
          description={
            query.cursor
              ? 'You have reached the end of this list.'
              : 'Try another brand or price, or show products that are out of stock.'
          }
        />
      )}
      <ListingPager path={path} query={query} nextCursor={page.nextCursor} />
    </div>
  )
}
