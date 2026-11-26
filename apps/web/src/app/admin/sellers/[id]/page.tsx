import { getSeller, NotFoundError } from '@ecokart/core'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { SellerDetailManager } from '@/components/admin/seller-detail-manager'
import { SellerMoney } from '@/components/admin/seller-money'
import { ContentLoading } from '@/components/ui/page-loading'
import type { SellerDetail } from '@/lib/admin-sellers'
import { requireAdminPageContext } from '@/lib/page-auth'
import { getSellerServices } from '@/lib/sellers'

export const metadata: Metadata = {
  title: 'Seller details',
}

export const instant = false

export default async function SellerDetailPage({
  params,
  searchParams,
}: PageProps<'/admin/sellers/[id]'>) {
  const { id } = await params
  const context = await requireAdminPageContext('/admin/sellers')
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
  const query = await searchParams
  const cursor = Array.isArray(query.ledgerCursor)
    ? query.ledgerCursor.at(-1)
    : query.ledgerCursor
  const balanceCursor = Array.isArray(query.balanceCursor)
    ? query.balanceCursor.at(-1)
    : query.balanceCursor
  return (
    <SellerDetailManager
      initialSeller={serialised}
      money={
        <Suspense fallback={<ContentLoading />}>
          <SellerMoney
            sellerId={id}
            context={context}
            cursor={cursor}
            balanceCursor={balanceCursor}
          />
        </Suspense>
      }
    />
  )
}
