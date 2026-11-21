import { getImport, withContext, NotFoundError } from '@ecokart/core'
import { notFound } from 'next/navigation'
import { ImportDetail } from '@/components/seller/import-manager'
import { PageHeader } from '@/components/ui/page-header'
import { requireSellerPageContext } from '@/lib/page-auth'
import { getDatabase } from '@/lib/db'
import type { CatalogueImport } from '@/lib/catalogue-operations'

export const metadata = { title: 'Catalogue import' }
export const instant = false
export default async function ImportPage({
  params,
}: PageProps<'/seller/imports/[id]'>) {
  const { id } = await params
  const context = await requireSellerPageContext(`/seller/imports/${id}`)
  let item
  try {
    item = await withContext(getDatabase(), context, (tx) =>
      getImport(tx, context, id),
    )
  } catch (cause) {
    if (cause instanceof NotFoundError) notFound()
    throw cause
  }
  const serialised: CatalogueImport = {
    ...item,
    fields: [...item.fields],
    createdAt: item.createdAt.toISOString(),
    completedAt: item.completedAt?.toISOString() ?? null,
  }
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Catalogue import"
        description="Review columns and follow draft creation."
      />
      <ImportDetail initialImport={serialised} />
    </div>
  )
}
