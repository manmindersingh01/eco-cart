import { DocumentReviewQueue } from '@/components/admin/document-review-manager'
import { PageHeader } from '@/components/ui/page-header'
import { requireAdminPage } from '@/lib/page-auth'

export const metadata = { title: 'Document review' }
export const instant = false
export default async function DocumentQueuePage() {
  await requireAdminPage('/admin/seller-documents')
  return (
    <div className="grid gap-7">
      <PageHeader
        title="Document review"
        description="Checked seller documents waiting for administrator review, oldest first."
      />
      <DocumentReviewQueue />
    </div>
  )
}
