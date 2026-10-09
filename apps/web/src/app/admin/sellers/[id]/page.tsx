import { getSeller, NotFoundError } from '@ecokart/core'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { SellerDetailManager } from '@/components/admin/seller-detail-manager'
import type { SellerDetail } from '@/lib/admin-sellers'
import { requireAdmin } from '@/lib/request-context'
import { getSellerServices } from '@/lib/sellers'

export const metadata: Metadata = {
  title: 'Seller details | EcoKart',
}

export default async function SellerDetailPage({
  params,
}: PageProps<'/admin/sellers/[id]'>) {
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
