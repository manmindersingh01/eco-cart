import { getFullCategoryTree, withContext } from '@ecokart/core'
import type { Metadata } from 'next'
import { CategoryManager } from '@/components/admin/category-manager'
import { PageHeader } from '@/components/ui/page-header'
import type { CategoryNode } from '@/lib/admin-catalogue'
import { getDatabase } from '@/lib/db'
import { requireAdminPageContext } from '@/lib/page-auth'

export const metadata: Metadata = {
  title: 'Categories',
}

export const instant = false

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
  const context = await requireAdminPageContext('/admin/categories')
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
