import { EmptyState } from '@/components/ui/feedback'
import { PageHeader } from '@/components/ui/page-header'

export default function AdminPage() {
  return (
    <div className="grid gap-8">
      <PageHeader
        title="Administrator portal"
        description="Manage the EcoKart marketplace from one place."
      />
      <EmptyState
        title="Administrator tools are being prepared"
        description="Platform settings, sellers, categories, and brands will appear here as each frontend task is completed."
      />
    </div>
  )
}
