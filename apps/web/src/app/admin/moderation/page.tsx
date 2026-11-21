import { ModerationQueue } from '@/components/admin/moderation-manager'
import { PageHeader } from '@/components/ui/page-header'
import { requireAdminPageContext } from '@/lib/page-auth'

export const metadata = { title: 'Product moderation' }
export const instant = false
export default async function ModerationPage() {
  await requireAdminPageContext('/admin/moderation')
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Product moderation"
        description="Screen, review and publish seller listings."
      />
      <ModerationQueue />
    </div>
  )
}
