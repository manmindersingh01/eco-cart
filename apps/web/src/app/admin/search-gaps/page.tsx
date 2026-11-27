import { SearchGapsReportContent } from '@/components/admin/ai-reports'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { EarningsRefresh } from '@/components/seller/earnings-refresh'
import { PageHeader } from '@/components/ui/page-header'
import { ContentLoading } from '@/components/ui/page-loading'

export const metadata: Metadata = {
  title: 'Search gaps',
  robots: { index: false },
}
export const instant = false
export default function SearchGapsPage(props: PageProps<'/admin/search-gaps'>) {
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Search gaps"
        description="Up to 100 search phrases that found no products, grouped without case differences and ordered by frequency. Photo searches have no phrase and are excluded."
        actions={<EarningsRefresh label="Refresh search gaps" />}
      />
      <Suspense fallback={<ContentLoading />}>
        <SearchGapsReportContent {...props} />
      </Suspense>
    </div>
  )
}
