import { ProductGrid } from '@/components/storefront/product-card'
import { readSimilarProducts } from '@/lib/storefront'

export async function SimilarProducts({ slug }: { slug: string }) {
  let products
  try {
    products = await readSimilarProducts(slug)
  } catch {
    return (
      <p className="text-sm text-muted">
        Similar products are unavailable right now. You can still shop this
        product.
      </p>
    )
  }
  if (!products.items.length)
    return (
      <p className="text-sm text-muted">No similar products to show yet.</p>
    )
  return <ProductGrid products={products.items} />
}
