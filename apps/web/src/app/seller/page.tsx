import { EmptyState } from '@/components/ui/feedback'
import { PageHeader } from '@/components/ui/page-header'

export default function SellerPage() {
  return (
    <div className="grid gap-8">
      <PageHeader
        title="Seller portal"
        description="Manage your business details and product catalogue."
      />
      <EmptyState
        title="Seller tools are being prepared"
        description="Your business profile and product tools will appear here as each frontend task is completed."
      />
    </div>
  )
}
