import { MAX_LINE_QUANTITY, NotFoundError } from '@ecokart/core'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { Breadcrumbs } from '@/components/storefront/breadcrumbs'
import { Rating } from '@/components/storefront/product-card'
import { ProductGallery } from '@/components/storefront/product-gallery'
import { ProductPurchase } from '@/components/storefront/product-purchase'
import { StatusBadge } from '@/components/ui/feedback'
import { PageLoading } from '@/components/ui/page-loading'
import { PublicReviews } from '@/components/storefront/public-reviews'
import { OwnReviewForm } from '@/components/storefront/own-review'
import { SimilarProducts } from '@/components/storefront/similar-products'
import { readProductPage, readProductReviews } from '@/lib/storefront'
import { formatRating } from '@/lib/storefront-display'

const REVIEWS_SHOWN = 10

export async function generateMetadata({
  params,
}: PageProps<'/products/[slug]'>): Promise<Metadata> {
  const { slug } = await params
  try {
    const product = await readProductPage(slug)
    const image = product.images[0]
    return {
      title: product.title,
      description: product.description.slice(0, 160) || undefined,
      alternates: { canonical: `/products/${product.slug}` },
      openGraph: image
        ? { images: [{ url: image.urls.card, alt: image.alt }] }
        : undefined,
    }
  } catch (cause) {
    if (cause instanceof NotFoundError) return { title: 'Product not found' }
    throw cause
  }
}

export default function ProductPage(props: PageProps<'/products/[slug]'>) {
  return (
    <main id="main-content" className="page-container flex-1 py-8 sm:py-10">
      {/* The address is read per request, inside the boundary; the product
          comes from the cached storefront read, and only the cart button
          talks to the visitor's cart, in the browser. */}
      <Suspense fallback={<PageLoading />}>
        <ProductContent {...props} />
      </Suspense>
    </main>
  )
}

async function ProductContent({ params }: PageProps<'/products/[slug]'>) {
  const { slug } = await params
  let product
  try {
    product = await readProductPage(slug)
  } catch (cause) {
    if (cause instanceof NotFoundError) notFound()
    throw cause
  }
  const reviews = await readProductReviews(product.slug, {
    limit: String(REVIEWS_SHOWN),
  })
  const attributes = Object.entries(product.attributes)

  return (
    <div className="grid gap-10">
      <div className="grid gap-6">
        <Breadcrumbs trail={product.breadcrumbs} />
        <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
          <ProductGallery
            title={product.title}
            images={product.images}
            video={product.video}
          />
          <div className="grid gap-6">
            <div>
              {product.brand ? (
                <p className="text-sm font-semibold text-brand-strong">
                  {product.brand.name}
                </p>
              ) : null}
              <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
                {product.title}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <Rating
                  average={product.ratingAvg}
                  count={product.ratingCount}
                  className="text-sm"
                />
                <p className="text-muted">
                  Sold by{' '}
                  <span className="font-medium text-foreground">
                    {product.seller.displayName}
                  </span>
                </p>
              </div>
            </div>
            {product.variants.length ? (
              <ProductPurchase
                optionNames={product.optionNames}
                variants={product.variants}
                minOrderQuantity={product.minOrderQuantity}
                maxQuantity={MAX_LINE_QUANTITY}
              />
            ) : (
              <StatusBadge tone="danger">Not available right now</StatusBadge>
            )}
            {product.highlights.length ? (
              <section aria-labelledby="highlights">
                <h2 id="highlights" className="font-semibold">
                  Highlights
                </h2>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {product.highlights.map((highlight) => (
                    <li key={highlight}>{highlight}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
        {product.description ? (
          <section aria-labelledby="description">
            <h2 id="description" className="text-xl font-semibold">
              About this product
            </h2>
            {/* Plain text: the seller's words are never rendered as HTML. */}
            <p className="mt-3 whitespace-pre-line break-words text-muted">
              {product.description}
            </p>
          </section>
        ) : null}
        {attributes.length ? (
          <section aria-labelledby="details">
            <h2 id="details" className="text-xl font-semibold">
              Details
            </h2>
            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
              {attributes.map(([name, value]) => (
                <div key={name} className="contents">
                  {/* The seller's own words, starting with a capital. */}
                  <dt className="text-muted first-letter:uppercase">{name}</dt>
                  <dd className="break-words font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
      </div>

      <section aria-labelledby="reviews" className="grid gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="reviews" className="text-xl font-semibold">
            Reviews
          </h2>
          {product.ratingCount ? (
            <p className="text-sm text-muted">
              <span className="text-lg font-semibold text-foreground">
                {formatRating(product.ratingAvg)}
              </span>{' '}
              out of 5, from {product.ratingCount.toLocaleString('en-IN')}{' '}
              {product.ratingCount === 1 ? 'review' : 'reviews'}
            </p>
          ) : null}
        </div>
        <PublicReviews
          key={reviews.items
            .map((item) => `${item.id}-${item.updatedAt.toISOString()}`)
            .join(',')}
          slug={product.slug}
          initial={reviews}
        />
      </section>
      <OwnReviewForm key={product.slug} slug={product.slug} />
      <section aria-label="Similar products" className="grid gap-4">
        <h2 className="text-xl font-semibold">Similar products</h2>
        <Suspense
          fallback={
            <p className="text-sm text-muted">Loading similar products...</p>
          }
        >
          <SimilarProducts slug={product.slug} />
        </Suspense>
      </section>
    </div>
  )
}
