import { getOwnSeller } from '@ecokart/core'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { LinkButton } from '@/components/ui/button'
import { Card, Notice, StatusBadge } from '@/components/ui/feedback'
import { PageHeader } from '@/components/ui/page-header'
import { getDatabase } from '@/lib/db'
import { requireSeller } from '@/lib/request-context'
import { sellerStatusPresentation } from '@/lib/seller-profile'

export const metadata: Metadata = {
  title: 'Seller portal | EcoKart',
}

export default async function SellerPage() {
  const requestHeaders = await headers()
  const { context } = await requireSeller(requestHeaders)
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
      <section aria-labelledby="seller-tools">
        <h2 id="seller-tools" className="text-xl font-semibold">
          Available tools
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Card className="flex flex-col items-start">
            <div className="flex w-full items-start justify-between gap-3">
              <h3 className="text-lg font-semibold">Business profile</h3>
              <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            </div>
            <p className="mt-2 flex-1 text-sm text-muted">
              Review legal, tax, address, invoice, commission, and status
              details. Update your display name and customer support contacts.
            </p>
            <LinkButton href="/seller/profile" className="mt-5">
              View business profile
            </LinkButton>
          </Card>
          <Card className="flex flex-col items-start">
            <h3 className="text-lg font-semibold">Product catalogue</h3>
            <p className="mt-2 flex-1 text-sm text-muted">
              Create and manage draft product listings. Pending sellers can
              prepare drafts while public selling waits for approval.
            </p>
            <LinkButton href="/seller/products" className="mt-5">
              Manage products
            </LinkButton>
          </Card>
        </div>
      </section>
    </div>
  )
}
