import { getOwnSeller } from '@ecokart/core'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { SellerProfileManager } from '@/components/seller/profile-manager'
import type { SellerProfile } from '@/lib/seller-profile'
import { getDatabase } from '@/lib/db'
import { requireSeller } from '@/lib/request-context'

export const metadata: Metadata = {
  title: 'Business profile | EcoKart',
}

export default async function SellerProfilePage() {
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
