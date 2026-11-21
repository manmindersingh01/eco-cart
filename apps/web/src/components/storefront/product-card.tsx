import type { ProductCard as ProductCardData } from '@ecokart/core'
import Link from 'next/link'
import { NoPhoto, ProductPhoto } from './product-photo'
import {
  discountPercent,
  formatPrice,
  formatRating,
} from '@/lib/storefront-display'

/** Grids of 2, 3, 4, or 6 columns, which a page of 24 products fills. */
export function ProductGrid({
  products,
  priority = 0,
}: {
  products: readonly ProductCardData[]
  /** How many of the first photos to load first, for the top of a page. */
  priority?: number
}) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-6">
      {products.map((product, index) => (
        <li key={product.id} className="min-w-0">
          <ProductCard product={product} priority={index < priority} />
        </li>
      ))}
    </ul>
  )
}

export function ProductCard({
  product,
  priority = false,
}: {
  product: ProductCardData
  priority?: boolean
}) {
  // One price: its MRP and discount mean something. A range of variants
  // shows its lowest price instead, as "From".
  const singlePrice = product.minPricePaise === product.maxPricePaise
  const discount = singlePrice
    ? discountPercent(product.minPricePaise, product.minMrpPaise)
    : null
  return (
    <article className="relative flex h-full flex-col overflow-hidden rounded-xl border bg-surface transition-colors focus-within:border-brand hover:border-brand">
      <div className="relative aspect-square overflow-hidden bg-surface-subtle">
        {product.image ? (
          <ProductPhoto
            image={product.image}
            sizes="(min-width: 1280px) 16vw, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
            priority={priority}
          />
        ) : (
          <NoPhoto />
        )}
        {product.inStock ? null : (
          <span className="absolute top-2 left-2 rounded-full border border-danger/35 bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger">
            Out of stock
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3 sm:p-4">
        {product.brand ? (
          <p className="truncate text-xs font-medium text-muted">
            {product.brand.name}
          </p>
        ) : null}
        <h3 className="line-clamp-2 text-sm font-semibold">
          <Link
            href={`/products/${product.slug}`}
            className="rounded-sm after:absolute after:inset-0 focus-visible:outline-none"
          >
            {product.title}
          </Link>
        </h3>
        <Rating average={product.ratingAvg} count={product.ratingCount} />
        <p className="mt-auto flex flex-wrap items-baseline gap-x-2 pt-1">
          <span className="font-semibold">
            {singlePrice ? null : <span className="text-sm">From </span>}
            {formatPrice(product.minPricePaise)}
          </span>
          {discount ? (
            <>
              <s className="text-xs text-muted">
                <span className="sr-only">MRP </span>
                {formatPrice(product.minMrpPaise)}
              </s>
              <span className="text-xs font-semibold text-success">
                {discount}% off
              </span>
            </>
          ) : null}
        </p>
        {product.minOrderQuantity > 1 ? (
          <p className="text-xs text-muted">Min. {product.minOrderQuantity}</p>
        ) : null}
      </div>
    </article>
  )
}

/** Stars as a number, for example "★ 4.5 (12)", or that there are none yet. */
export function Rating({
  average,
  count,
  className,
}: {
  average: number
  count: number
  className?: string
}) {
  if (count === 0) {
    return (
      <p className={`text-xs text-muted ${className ?? ''}`}>No reviews yet</p>
    )
  }
  return (
    <p className={`flex items-center gap-1 text-xs ${className ?? ''}`}>
      <span aria-hidden="true" className="text-warning">
        ★
      </span>
      <span className="font-semibold">
        <span className="sr-only">Rated </span>
        {formatRating(average)}
        <span className="sr-only"> out of 5</span>
      </span>
      <span className="text-muted">
        ({count.toLocaleString('en-IN')}
        <span className="sr-only"> {count === 1 ? 'review' : 'reviews'}</span>)
      </span>
    </p>
  )
}
