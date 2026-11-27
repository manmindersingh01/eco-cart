import { listReviews, ValidationError, withContext } from '@ecokart/core'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ReviewDecision } from '@/components/admin/review-decision'
import { EarningsRefresh } from '@/components/seller/earnings-refresh'
import { ReviewContent } from '@/components/storefront/review-content'
import { LinkButton } from '@/components/ui/button'
import { Card, EmptyState, Notice, StatusBadge } from '@/components/ui/feedback'
import { PageHeader } from '@/components/ui/page-header'
import { ContentLoading } from '@/components/ui/page-loading'
import { getDatabase } from '@/lib/db'
import { requireAdminPageContext } from '@/lib/page-auth'

export const metadata: Metadata = {
  title: 'Review moderation',
  robots: { index: false },
}
export const instant = false
export default function ReviewsPage(props: PageProps<'/admin/reviews'>) {
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Review moderation"
        description="Published reviews count towards product ratings. Hidden reviews remain visible to their author."
        actions={<EarningsRefresh label="Refresh reviews" />}
      />
      <Suspense fallback={<ContentLoading />}>
        <Reviews {...props} />
      </Suspense>
    </div>
  )
}
async function Reviews({ searchParams }: PageProps<'/admin/reviews'>) {
  const context = await requireAdminPageContext('/admin/reviews')
  const query = await searchParams
  const status =
    (Array.isArray(query.status) ? query.status.at(-1) : query.status) ??
    'published'
  const cursor = Array.isArray(query.cursor)
    ? query.cursor.at(-1)
    : query.cursor
  let page
  let problem: string | undefined
  try {
    page = await withContext(getDatabase(), context, (tx) =>
      listReviews(tx, context, { status, cursor, limit: 20 }),
    )
  } catch (cause) {
    if (!(cause instanceof ValidationError)) throw cause
    problem = cause.message
  }
  return (
    <>
      <nav aria-label="Review status" className="flex flex-wrap gap-3">
        {(['published', 'hidden'] as const).map((value) => (
          <LinkButton
            key={value}
            href={{ pathname: '/admin/reviews', query: { status: value } }}
            variant={status === value ? 'primary' : 'secondary'}
            aria-current={status === value ? 'page' : undefined}
          >
            {value === 'published' ? 'Published reviews' : 'Hidden reviews'}
          </LinkButton>
        ))}
      </nav>
      {problem ? (
        <Notice tone="danger" title="Reviews could not be shown">
          <p>{problem}</p>
          <LinkButton className="mt-3" href="/admin/reviews">
            Show published reviews
          </LinkButton>
        </Notice>
      ) : page ? (
        <>
          <section aria-label="Moderation list" className="grid gap-3">
            {page.items.length ? (
              <ul className="grid gap-4">
                {page.items.map((review) => (
                  <li key={review.id} data-review-id={review.id}>
                    <Card className="grid min-w-0 gap-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h2 className="min-w-0 font-semibold break-words">
                          {review.product?.title ?? 'Product unavailable'}
                        </h2>
                        <StatusBadge
                          tone={
                            review.status === 'hidden' ? 'warning' : 'success'
                          }
                        >
                          {review.status === 'hidden' ? 'Hidden' : 'Published'}
                        </StatusBadge>
                      </div>
                      <ReviewContent review={review} />
                      {review.product ? (
                        <div>
                          <LinkButton
                            href={`/products/${review.product.slug}`}
                            variant="secondary"
                          >
                            View product
                          </LinkButton>
                        </div>
                      ) : null}
                      <ReviewDecision
                        id={review.id}
                        status={review.status}
                        author={review.authorName}
                      />
                    </Card>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title={
                  cursor
                    ? 'No more reviews'
                    : status === 'hidden'
                      ? 'No hidden reviews'
                      : 'No published reviews'
                }
                description="Reviews appear here with the status selected above."
              />
            )}
          </section>
          <nav aria-label="Review pages" className="flex flex-wrap gap-3">
            {cursor ? (
              <LinkButton
                href={{ pathname: '/admin/reviews', query: { status } }}
                variant="secondary"
              >
                Show latest reviews
              </LinkButton>
            ) : null}
            {page.nextCursor ? (
              <LinkButton
                href={{
                  pathname: '/admin/reviews',
                  query: { status, cursor: page.nextCursor },
                }}
              >
                Older reviews
              </LinkButton>
            ) : null}
          </nav>
        </>
      ) : null}
    </>
  )
}
