import { getProductForReview, NotFoundError, withContext } from '@ecokart/core'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { ListingReviewManager } from '@/components/admin/listing-review'
import { PageHeader } from '@/components/ui/page-header'
import { ContentLoading } from '@/components/ui/page-loading'
import { getDatabase } from '@/lib/db'
import type { ListingReview } from '@/lib/listing-review'
import { requireAdminPageContext } from '@/lib/page-auth'
import { getStorage } from '@/lib/storage'

export const metadata: Metadata = {
  title: 'Review listing',
}

export const instant = false

export default function ReviewListingPage(
  props: PageProps<'/admin/moderation/[id]'>,
) {
  return (
    <div className="grid gap-7">
      <PageHeader
        title="Review listing"
        description="Everything the buyer will see, with the screening result, before you decide."
      />
      <Suspense fallback={<ContentLoading />}>
        <Review {...props} />
      </Suspense>
    </div>
  )
}

async function Review({ params }: PageProps<'/admin/moderation/[id]'>) {
  const { id } = await params
  const context = await requireAdminPageContext('/admin/moderation')
  let found
  try {
    found = await withContext(getDatabase(), context, (tx) =>
      getProductForReview(tx, getStorage(), context, id),
    )
  } catch (cause) {
    if (cause instanceof NotFoundError) notFound()
    throw cause
  }
  const review: ListingReview = {
    seller: found.seller,
    product: {
      ...found.product,
      publishedAt: found.product.publishedAt?.toISOString() ?? null,
      createdAt: found.product.createdAt.toISOString(),
      updatedAt: found.product.updatedAt.toISOString(),
    },
    reviews: found.reviews.map((record) => ({
      ...record,
      submittedAt: record.submittedAt.toISOString(),
      decidedAt: record.decidedAt?.toISOString() ?? null,
    })),
  }
  return <ListingReviewManager initialReview={review} />
}
