import { listAllBrands, ValidationError, withContext } from '@ecokart/core'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { BrandManager } from '@/components/admin/brand-manager'
import { PageHeader } from '@/components/ui/page-header'
import type { Brand } from '@/lib/admin-catalogue'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

export const metadata: Metadata = {
  title: 'Brands | EcoKart',
}

export default async function AdminBrandsPage({
  searchParams,
}: PageProps<'/admin/brands'>) {
  const params = await searchParams
  const query = typeof params.q === 'string' ? params.q : ''
  const cursor = typeof params.cursor === 'string' ? params.cursor : undefined
  const requestHeaders = await headers()
  const { context } = await requireAdmin(requestHeaders)
  let items: Brand[] = []
  let nextCursor: string | null = null
  let error: string | undefined
  try {
    const page = await withContext(getDatabase(), context, (tx) =>
      listAllBrands(tx, context, {
        ...(query ? { q: query } : {}),
        ...(cursor ? { cursor } : {}),
        limit: 20,
      }),
    )
    items = page.items.map((brand) => ({
      ...brand,
      createdAt: brand.createdAt.toISOString(),
      updatedAt: brand.updatedAt.toISOString(),
    }))
    nextCursor = page.nextCursor
  } catch (cause) {
    if (cause instanceof ValidationError) error = cause.message
    else throw cause
  }

  return (
    <div className="grid gap-7">
      <PageHeader
        title="Brands"
        description="Search, create, edit, deactivate, and remove brands available to seller listings."
      />
      <BrandManager
        initialPage={{ items, nextCursor }}
        initialQuery={query}
        initialCursor={cursor}
        initialError={error}
      />
    </div>
  )
}
