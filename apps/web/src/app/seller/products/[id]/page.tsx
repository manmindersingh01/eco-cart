import { getOwnProduct, NotFoundError, withContext } from '@ecokart/core'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import SellerLoading from '../../loading'
import { ProductEditor } from '@/components/seller/product-editor'
import { getDatabase } from '@/lib/db'
import { requireSellerPageContext } from '@/lib/page-auth'
import type { SellerProduct } from '@/lib/product-editor'
import { getStorage } from '@/lib/storage'

export const metadata: Metadata = {
  title: 'Product editor',
}

export const instant = false

export default function SellerProductPage(
  props: PageProps<'/seller/products/[id]'>,
) {
  return (
    <Suspense fallback={<SellerLoading />}>
      <SellerProductContent {...props} />
    </Suspense>
  )
}

async function SellerProductContent({
  params,
}: PageProps<'/seller/products/[id]'>) {
  const { id } = await params
  const context = await requireSellerPageContext('/seller/products')
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
