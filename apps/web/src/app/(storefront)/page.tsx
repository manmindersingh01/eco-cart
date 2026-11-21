import type { HomeSection } from '@ecokart/core'
import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { BrandDiscovery } from '@/components/storefront/brand-discovery'
import { ProductGrid } from '@/components/storefront/product-card'
import { Card, EmptyState } from '@/components/ui/feedback'
import { getPublicBrands, getPublicCategories } from '@/lib/public-catalogue'
import type { PublicCategory } from '@/lib/seller-products'
import { readHomePage } from '@/lib/storefront'

export const metadata: Metadata = {
  // absolute: the root template would add a second "| EcoKart".
  title: { absolute: 'EcoKart | Independent sellers across India' },
  description:
    'Shop reviewed products from independent sellers across India, with prices that include GST.',
}

export default async function HomePage() {
  await connection()
  const [categories, brands, sections] = await Promise.all([
    getPublicCategories(),
    getPublicBrands({ limit: 12 }),
    readHomePage(),
  ])
  const shelves = sections.filter((section) => section.products.length > 0)

  return (
    <main id="main-content" className="min-w-0 flex-1">
      {/* Short, so the first products show without scrolling on a phone. */}
      <section className="border-b bg-[linear-gradient(145deg,var(--brand-soft),var(--surface)_58%,var(--background))]">
        <div className="page-container py-8 sm:py-12">
          <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
            Thoughtful products from independent sellers across India.
          </h1>
          <p className="mt-3 max-w-2xl text-muted sm:mt-4 sm:text-lg">
            Every listing is reviewed before it goes on sale, and every price
            includes GST.
          </p>
          <div className="mt-5 flex flex-wrap gap-3 sm:mt-6">
            <a
              href={shelves.length ? '#new-arrivals' : '#categories'}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong"
            >
              {shelves.length ? 'Shop new arrivals' : 'Explore categories'}
            </a>
            <a
              href="#categories"
              className="inline-flex min-h-11 items-center justify-center rounded-lg border bg-surface px-4 py-2 text-sm font-semibold hover:border-brand hover:text-brand-strong"
            >
              Browse categories
            </a>
          </div>
        </div>
      </section>

      {shelves.length ? (
        shelves.map((section) => (
          <Shelf key={section.category?.id ?? section.kind} section={section} />
        ))
      ) : (
        <section className="page-container pt-14 sm:pt-20">
          <EmptyState
            title="Products are on their way"
            description="Sellers' listings appear here once they are reviewed. Browse the categories below in the meantime."
          />
        </section>
      )}

      <section
        id="categories"
        className="page-container scroll-mt-28 py-14 sm:py-20"
      >
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-strong">
            Browse the structure
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">
            Active categories
          </h2>
          <p className="mt-3 text-muted">
            Open a category to see its products, with filters for brand, price,
            and stock.
          </p>
        </div>
        {categories.length ? (
          <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {categories.map((category) => (
              <CategoryCard key={category.id} category={category} />
            ))}
          </div>
        ) : (
          <div className="mt-8">
            <EmptyState
              title="Categories are being prepared"
              description="The catalogue team has not published any category choices yet."
            />
          </div>
        )}
      </section>

      <section
        aria-labelledby="promises-title"
        className="border-t bg-surface-subtle"
      >
        <div className="page-container py-10 sm:py-14">
          <h2 id="promises-title" className="sr-only">
            Why shop on EcoKart
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <PromiseCard
              title="Reviewed listings"
              text="Every listing is checked before it reaches buyers."
            />
            <PromiseCard
              title="Clear pricing"
              text="Prices include GST, in familiar Indian formatting."
            />
            <PromiseCard
              title="Independent sellers"
              text="Each business manages its own catalogue and stock."
            />
            <PromiseCard
              title="Safe photos"
              text="Every product photo is checked and resized before display."
            />
          </div>
        </div>
      </section>

      <section id="brands" className="scroll-mt-28 border-y">
        <div className="page-container py-14 sm:py-20">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-strong">
              Meet the makers
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">
              Active brands
            </h2>
            <p className="mt-3 text-muted">
              Search a bounded list of brands already approved for seller
              listings.
            </p>
          </div>
          <div className="mt-8">
            <BrandDiscovery initialPage={brands} />
          </div>
        </div>
      </section>
    </main>
  )
}

function PromiseCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border bg-surface p-4">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted">{text}</p>
    </div>
  )
}

function CategoryCard({ category }: { category: PublicCategory }) {
  return (
    <Card flush>
      <div className="border-b bg-brand-soft p-5">
        <h3 className="text-xl font-semibold text-brand-strong">
          <Link
            href={`/categories/${category.slug}`}
            className="hover:underline"
          >
            {category.name}
          </Link>
        </h3>
      </div>
      <div className="p-5">
        {category.children.length ? (
          <ul className="grid gap-4">
            {category.children.map((child) => (
              <li key={child.id}>
                <p className="font-semibold">
                  <Link
                    href={`/categories/${child.slug}`}
                    className="hover:text-brand-strong hover:underline"
                  >
                    {child.name}
                  </Link>
                </p>
                {child.children.length ? (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {child.children.map((leaf) => (
                      <li key={leaf.id}>
                        <Link
                          href={`/categories/${leaf.slug}`}
                          className="inline-flex min-h-9 items-center rounded-full border bg-surface-subtle px-3 text-sm text-muted hover:border-brand hover:text-brand-strong"
                        >
                          {leaf.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-muted">
                    No narrower group is needed.
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">
            This category is ready for direct product listings.
          </p>
        )}
      </div>
    </Card>
  )
}

/** New arrivals, or one top-level category's latest products. */
function Shelf({ section }: { section: HomeSection }) {
  const heading = section.category ? section.category.name : 'New arrivals'
  const id = section.category
    ? `shelf-${section.category.slug}`
    : 'new-arrivals'
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="page-container scroll-mt-28 pt-14 sm:pt-20"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2
          id={`${id}-title`}
          className="text-2xl font-semibold tracking-tight"
        >
          {heading}
        </h2>
        {section.category ? (
          <Link
            href={`/categories/${section.category.slug}`}
            className="text-sm font-semibold text-brand-strong underline-offset-4 hover:underline"
          >
            See all in {section.category.name}
          </Link>
        ) : null}
      </div>
      <div className="mt-5">
        <ProductGrid
          products={section.products}
          priority={section.kind === 'new_arrivals' ? 6 : 0}
        />
      </div>
    </section>
  )
}
