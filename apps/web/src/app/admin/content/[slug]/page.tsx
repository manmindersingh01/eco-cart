import { getContentPage, NotFoundError, withContext } from '@ecokart/core'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PolicyEditor } from '@/components/admin/policy-editor'
import { LinkButton } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { getDatabase } from '@/lib/db'
import { requireAdminPageContext } from '@/lib/page-auth'

export const metadata: Metadata = {
  title: 'Edit policy',
  robots: { index: false },
}
export const instant = false
export default async function PolicyEditorPage({
  params,
}: PageProps<'/admin/content/[slug]'>) {
  const context = await requireAdminPageContext('/admin/content')
  const { slug } = await params
  let page
  try {
    page = await withContext(getDatabase(), context, (tx) =>
      getContentPage(tx, context, slug),
    )
  } catch (cause) {
    if (cause instanceof NotFoundError) notFound()
    throw cause
  }
  return (
    <div className="grid gap-6">
      <PageHeader
        title={`Edit ${page.title}`}
        description={`/policies/${page.slug}`}
        actions={
          <LinkButton href="/admin/content" variant="secondary">
            Back to policies
          </LinkButton>
        }
      />
      <PolicyEditor
        key={page.slug}
        initial={{
          slug: page.slug,
          title: page.title,
          bodyMarkdown: page.bodyMarkdown,
          status: page.status,
          saved: page.saved,
        }}
      />
    </div>
  )
}
