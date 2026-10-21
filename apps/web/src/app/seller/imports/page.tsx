import { ImportList } from '@/components/seller/import-manager'
import { PageHeader } from '@/components/ui/page-header'
import { requireSellerPageContext } from '@/lib/page-auth'

export const metadata = { title: 'Catalogue imports' }
export const instant = false
export default async function ImportsPage() {
  await requireSellerPageContext('/seller/imports')
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Catalogue imports"
        description="Create draft products from a spreadsheet."
      />
      <ImportList />
    </div>
  )
}
