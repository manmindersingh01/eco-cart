import { listContentPages, withContext } from '@ecokart/core'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LinkButton } from '@/components/ui/button'
import { Card, StatusBadge } from '@/components/ui/feedback'
import { PageHeader } from '@/components/ui/page-header'
import { ContentLoading } from '@/components/ui/page-loading'
import { EarningsRefresh } from '@/components/seller/earnings-refresh'
import { getDatabase } from '@/lib/db'
import { formatIndianDate } from '@/lib/format'
import { requireAdminPageContext } from '@/lib/page-auth'

export const metadata: Metadata = {
  title: 'Policy pages',
  robots: { index: false },
}
export const instant = false
export default function ContentPage() {
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Policy pages"
        description="Edit the six shop policies. Drafts are private. Replace development placeholders with client-approved text before launch."
        actions={<EarningsRefresh label="Refresh policies" />}
      />
      <Suspense fallback={<ContentLoading />}>
        <Policies />
      </Suspense>
    </div>
  )
}
async function Policies() {
  const context = await requireAdminPageContext('/admin/content')
  const pages = await withContext(getDatabase(), context, (tx) =>
    listContentPages(tx, context),
  )
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {pages.map((page) => (
        <li key={page.slug}>
          <Card className="grid h-full gap-3">
            <h2 className="text-lg font-semibold break-words">{page.title}</h2>
            <p className="text-sm text-muted">/policies/{page.slug}</p>
            <div>
              <StatusBadge
                tone={page.status === 'published' ? 'success' : 'neutral'}
              >
                {page.saved
                  ? page.status === 'published'
                    ? 'Published'
                    : 'Draft'
                  : 'Unwritten draft'}
              </StatusBadge>
            </div>
            <p className="text-sm text-muted">
              {page.updatedAt
                ? `Updated ${formatIndianDate(page.updatedAt, { includeTime: true })}`
                : 'Not saved yet'}
            </p>
            <div>
              <LinkButton
                href={`/admin/content/${page.slug}`}
                variant="secondary"
              >
                Edit {page.title}
              </LinkButton>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  )
}
