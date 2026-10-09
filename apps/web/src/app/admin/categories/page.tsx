import { getFullCategoryTree, withContext } from '@ecokart/core'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { CategoryManager } from '@/components/admin/category-manager'
import { PageHeader } from '@/components/ui/page-header'
import type { CategoryNode } from '@/lib/admin-catalogue'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

export const metadata: Metadata = {
  title: 'Categories | EcoKart',
}

function serialiseCategory(
  node: Awaited<ReturnType<typeof getFullCategoryTree>>[number],
): CategoryNode {
  return {
    ...node,
    createdAt: node.createdAt.toISOString(),
    updatedAt: node.updatedAt.toISOString(),
    children: node.children.map(serialiseCategory),
  }
}

export default async function AdminCategoriesPage() {
  const requestHeaders = await headers()
  const { context } = await requireAdmin(requestHeaders)
  const categories = await withContext(getDatabase(), context, (tx) =>
    getFullCategoryTree(tx, context),
  )

  return (
    <div className="grid gap-7">
      <PageHeader
        title="Categories"
        description="Maintain the three-level category tree, GST rates, default HSN codes, and public visibility."
      />
      <CategoryManager initialTree={categories.map(serialiseCategory)} />
    </div>
  )
}
