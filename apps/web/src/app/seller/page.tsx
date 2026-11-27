import { getOwnSeller } from '@ecokart/core'
import type { Metadata } from 'next'
import { PortalTools } from '@/components/ui/portal-tools'
import { Notice, StatusBadge } from '@/components/ui/feedback'
import { PageHeader } from '@/components/ui/page-header'
import { sellerTools } from '@/lib/portal-tools'
import { getDatabase } from '@/lib/db'
import { requireSellerPageContext } from '@/lib/page-auth'
import { sellerStatusPresentation } from '@/lib/seller-profile'

export const metadata: Metadata = {
  title: 'Seller portal',
}

export const instant = false

export default async function SellerPage() {
  const context = await requireSellerPageContext('/seller')
  const seller = await getOwnSeller(getDatabase(), context)
  const status = sellerStatusPresentation(seller.status)

  return (
    <div className="grid gap-8">
      <PageHeader
        title={`Welcome, ${seller.displayName}`}
        description="Manage your EcoKart business from the seller portal."
      />
      <Notice title={status.title} tone={status.tone}>
        {status.description}
      </Notice>
      <PortalTools
        tools={sellerTools}
        badges={{
          '/seller/profile': (
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          ),
        }}
      />
    </div>
  )
}
