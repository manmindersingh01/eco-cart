import { getOwnProduct, NotFoundError, withContext } from '@ecokart/core'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { ProductEditor } from '@/components/seller/product-editor'
import { PageLoading } from '@/components/ui/page-loading'
import { getDatabase } from '@/lib/db'
import type { SellerProduct } from '@/lib/product-editor'
import { requireSeller } from '@/lib/request-context'
import { getStorage } from '@/lib/storage'

export const metadata: Metadata = {
  title: 'Product editor',
}

/** The seller's own product in the address. */
async function ProductForEditing({
  params,
}: Pick<PageProps<'/seller/products/[id]'>, 'params'>) {
  const { id } = await params
  const requestHeaders = await headers()
  const { context } = await requireSeller(requestHeaders)
  let product
  try {
    product = await withContext(getDatabase(), context, (tx) =>
      getOwnProduct(tx, getStorage(), context, id),
    )
  } catch (cause) {
    if (cause instanceof NotFoundError) notFound()
    throw cause
  }
  const serialised: SellerProduct = {
    ...product,
    publishedAt: product.publishedAt?.toISOString() ?? null,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  }
  return <ProductEditor initialProduct={serialised} />
}

export default function SellerProductPage({
  params,
}: PageProps<'/seller/products/[id]'>) {
  return (
    <Suspense fallback={<PageLoading />}>
      <ProductForEditing params={params} />
    </Suspense>
  )
}
