import type { Metadata } from 'next'
import { PortalTools } from '@/components/ui/portal-tools'
import { adminTools } from '@/lib/portal-tools'
import { PageHeader } from '@/components/ui/page-header'

export const metadata: Metadata = {
  title: 'Administrator portal',
}

export const instant = false

export default function AdminPage() {
  return (
    <div className="grid gap-8">
      <PageHeader
        title="Administrator portal"
        description="Manage the EcoKart marketplace from one place."
      />
      <PortalTools tools={adminTools} />
    </div>
  )
}
