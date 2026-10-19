import type { Metadata } from 'next'
import { connection } from 'next/server'
import { BrandDiscovery } from '@/components/storefront/brand-discovery'
import { Card, EmptyState, StatusBadge } from '@/components/ui/feedback'
import { getPublicBrands, getPublicCategories } from '@/lib/public-catalogue'
import { countCategories } from '@/lib/public-home'
import type { PublicCategory } from '@/lib/seller-products'

export const metadata: Metadata = {
  title: 'EcoKart | Independent sellers across India',
  description:
    'Explore EcoKart categories and active brands while our reviewed marketplace catalogue is prepared.',
}

export default async function HomePage() {
  await connection()
  const [categories, brands] = await Promise.all([
    getPublicCategories(),
    getPublicBrands({ limit: 12 }),
  ])

  return (
    <main id="main-content" className="min-w-0 flex-1">
      <section className="border-b bg-[linear-gradient(145deg,var(--brand-soft),var(--surface)_58%,var(--background))]">
        <div className="page-container grid gap-10 py-16 sm:py-24 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)] lg:items-center">
          <div>
            <StatusBadge tone="success">
              Built for shopping across India
            </StatusBadge>
            <h1 className="mt-6 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
              Thoughtful products from independent sellers, in one trusted
              marketplace.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted">
              EcoKart is preparing a reviewed catalogue across home, lifestyle,
              personal care, and everyday essentials. Explore the real category
              and brand choices already available to our sellers.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="#categories"
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong"
              >
                Explore categories
              </a>
              <a
                href="#brands"
                className="inline-flex min-h-11 items-center justify-center rounded-lg border bg-surface px-4 py-2 text-sm font-semibold hover:border-brand hover:text-brand-strong"
              >
                Discover brands
              </a>
            </div>
          </div>
          <Card className="grid gap-5 p-6 sm:p-8">
            <div>
              <p className="text-sm font-semibold text-brand-strong">
                Catalogue preview
              </p>
              <p className="mt-2 text-3xl font-semibold">
                {countCategories(categories).toLocaleString('en-IN')} visible
                categories
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <PromiseCard
                title="Reviewed listings"
                text="Sellers prepare listings before products reach buyers."
              />
              <PromiseCard
                title="Clear pricing"
                text="Prices will include GST and use familiar Indian formatting."
              />
              <PromiseCard
                title="Seller ownership"
                text="Each business manages its own catalogue and stock."
              />
              <PromiseCard
                title="Safe photos"
                text="Every product photo is checked and resized before display."
              />
            </div>
          </Card>
        </div>
      </section>

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
            These are the live catalogue choices available to EcoKart sellers.
            Product browsing will open after listings are reviewed and
            published.
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

      <section id="brands" className="scroll-mt-28 border-y bg-surface-subtle">
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

      <section className="page-container py-14 sm:py-20">
        <Card className="overflow-hidden border-brand/30 bg-brand-soft p-7 sm:p-10">
          <div className="max-w-3xl">
            <StatusBadge tone="warning">Shopping is coming next</StatusBadge>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight">
              The catalogue is real. Commerce opens after product approval.
            </h2>
            <p className="mt-3 text-muted">
              This release establishes secure administrator and seller portals.
              Public products, search, basket, checkout, payments, and orders
              arrive in later planned backend steps, so this page does not show
              placeholder products or broken shopping actions.
            </p>
          </div>
        </Card>
      </section>
    </main>
  )
}

function PromiseCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border bg-surface-subtle p-4">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted">{text}</p>
    </div>
  )
}

function CategoryCard({ category }: { category: PublicCategory }) {
  return (
    <Card className="p-0">
      <div className="border-b bg-brand-soft p-5">
        <h3 className="text-xl font-semibold text-brand-strong">
          {category.name}
        </h3>
      </div>
      <div className="p-5">
        {category.children.length ? (
          <ul className="grid gap-4">
            {category.children.map((child) => (
              <li key={child.id}>
                <p className="font-semibold">{child.name}</p>
                {child.children.length ? (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {child.children.map((leaf) => (
                      <li key={leaf.id}>
                        <span className="inline-flex rounded-full border bg-surface-subtle px-3 py-1 text-sm text-muted">
                          {leaf.name}
                        </span>
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
