import { AiUsageReportContent } from '@/components/admin/ai-reports'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { EarningsRefresh } from '@/components/seller/earnings-refresh'
import { PageHeader } from '@/components/ui/page-header'
import { ContentLoading } from '@/components/ui/page-loading'

export const metadata: Metadata = {
  title: 'AI usage',
  robots: { index: false },
}
export const instant = false
export default function AiUsagePage(props: PageProps<'/admin/ai'>) {
  return (
    <div className="grid gap-6">
      <PageHeader
        title="AI usage"
        description="Calls, failures, tokens and reported costs per India day and feature. Dates are inclusive; choose up to 92 days."
        actions={<EarningsRefresh label="Refresh AI usage" />}
      />
      <Suspense fallback={<ContentLoading />}>
        <AiUsageReportContent {...props} />
      </Suspense>
    </div>
  )
}
