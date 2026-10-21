import { getSeller, NotFoundError } from '@ecokart/core'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { SellerDetailManager } from '@/components/admin/seller-detail-manager'
import { PageLoading } from '@/components/ui/page-loading'
import type { SellerDetail } from '@/lib/admin-sellers'
import { requireAdmin } from '@/lib/request-context'
import { getSellerServices } from '@/lib/sellers'

export const metadata: Metadata = {
  title: 'Seller details',
}

/** The seller in the address, for the administrator signed in. */
async function SellerDetail({
  params,
}: Pick<PageProps<'/admin/sellers/[id]'>, 'params'>) {
  const { id } = await params
  const requestHeaders = await headers()
  const { context } = await requireAdmin(requestHeaders)
  let seller
  try {
    seller = await getSeller(getSellerServices(), context, id)
  } catch (cause) {
    if (cause instanceof NotFoundError) notFound()
    throw cause
  }

  const serialised: SellerDetail = {
    ...seller,
    approvedAt: seller.approvedAt?.toISOString() ?? null,
    createdAt: seller.createdAt.toISOString(),
    updatedAt: seller.updatedAt.toISOString(),
  }
  return <SellerDetailManager initialSeller={serialised} />
}

export default function SellerDetailPage({
  params,
}: PageProps<'/admin/sellers/[id]'>) {
  return (
    <Suspense fallback={<PageLoading />}>
      <SellerDetail params={params} />
    </Suspense>
  )
}
