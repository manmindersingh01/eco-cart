import { requireSellerPage } from '@/lib/page-auth'
import { DocumentsManager } from '@/components/seller/documents-manager'
import { PageHeader } from '@/components/ui/page-header'

export const metadata = { title: 'Verification documents' }
export const instant = false

export default async function DocumentsPage() {
  await requireSellerPage('/seller/documents')
  return (
    <div className="grid gap-7">
      <PageHeader
        title="Verification documents"
        description="Send and track documents requested by an administrator."
      />
      <DocumentsManager />
    </div>
  )
}
