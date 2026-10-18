import { getOwnSeller } from '@ecokart/core'
import type { Metadata } from 'next'
import { SellerProfileManager } from '@/components/seller/profile-manager'
import type { SellerProfile } from '@/lib/seller-profile'
import { getDatabase } from '@/lib/db'
import { requireSellerPageContext } from '@/lib/page-auth'

export const metadata: Metadata = {
  title: 'Business profile | EcoKart',
}

export default async function SellerProfilePage() {
  const context = await requireSellerPageContext('/seller/profile')
  const seller = await getOwnSeller(getDatabase(), context)
  const serialised: SellerProfile = {
    ...seller,
    approvedAt: seller.approvedAt?.toISOString() ?? null,
    createdAt: seller.createdAt.toISOString(),
    updatedAt: seller.updatedAt.toISOString(),
  }

  return <SellerProfileManager initialSeller={serialised} />
}
