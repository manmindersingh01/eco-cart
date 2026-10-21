import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ListingReviewQueue } from '@/components/admin/listing-review'
import { PageHeader } from '@/components/ui/page-header'
import { ContentLoading } from '@/components/ui/page-loading'
import { requireAdminPage } from '@/lib/page-auth'

export const metadata: Metadata = {
  title: 'Listing review',
}

export const instant = false

export default function ListingReviewPage() {
  return (
    <div className="grid gap-7">
      <PageHeader
        title="Listing review"
        description="Listings sellers submitted, highest screening risk first, then oldest first. Open one to see its photos, video, variants, and tax details before deciding."
      />
      <Suspense fallback={<ContentLoading />}>
        <Queue />
      </Suspense>
    </div>
  )
}

async function Queue() {
  await requireAdminPage('/admin/moderation')
  return <ListingReviewQueue />
}
