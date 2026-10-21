import { getOwnSeller } from '@ecokart/core'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { Suspense } from 'react'
import { SellerProfileManager } from '@/components/seller/profile-manager'
import { PageLoading } from '@/components/ui/page-loading'
import type { SellerProfile } from '@/lib/seller-profile'
import { getDatabase } from '@/lib/db'
import { requireSeller } from '@/lib/request-context'

export const metadata: Metadata = {
  title: 'Business profile',
}

/** The business profile of the seller signed in. */
async function BusinessProfile() {
  const requestHeaders = await headers()
  const { context } = await requireSeller(requestHeaders)
  const seller = await getOwnSeller(getDatabase(), context)
  const serialised: SellerProfile = {
    ...seller,
    approvedAt: seller.approvedAt?.toISOString() ?? null,
    createdAt: seller.createdAt.toISOString(),
    updatedAt: seller.updatedAt.toISOString(),
  }

  return <SellerProfileManager initialSeller={serialised} />
}

export default function SellerProfilePage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <BusinessProfile />
    </Suspense>
  )
}
