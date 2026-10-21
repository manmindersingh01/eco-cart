import { getProductForReview, withContext, NotFoundError } from '@ecokart/core'
import { notFound } from 'next/navigation'
import { ModerationDetail } from '@/components/admin/moderation-manager'
import { PageHeader } from '@/components/ui/page-header'
import { requireAdminPageContext } from '@/lib/page-auth'
import { getDatabase } from '@/lib/db'
import { getStorage } from '@/lib/storage'
import type { ListingReview } from '@/lib/catalogue-operations'

export const metadata = { title: 'Review listing' }
export const instant = false
export default async function ListingReviewPage({
  params,
}: PageProps<'/admin/moderation/[id]'>) {
  const { id } = await params
  const context = await requireAdminPageContext(`/admin/moderation/${id}`)
  let review
  try {
    review = await withContext(getDatabase(), context, (tx) =>
      getProductForReview(tx, getStorage(), context, id),
    )
  } catch (cause) {
    if (cause instanceof NotFoundError) notFound()
    throw cause
  }
  const serialised: ListingReview = {
    ...review,
    product: {
      ...review.product,
      createdAt: review.product.createdAt.toISOString(),
      updatedAt: review.product.updatedAt.toISOString(),
      publishedAt: review.product.publishedAt?.toISOString() ?? null,
    },
    reviews: review.reviews.map((item) => ({
      ...item,
      submittedAt: item.submittedAt.toISOString(),
      decidedAt: item.decidedAt?.toISOString() ?? null,
    })),
  }
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Review listing"
        description="Check commercial details, media and screening before deciding."
      />
      <ModerationDetail initialReview={serialised} />
    </div>
  )
}
