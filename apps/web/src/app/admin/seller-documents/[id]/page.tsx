import { getDocumentRequest, withContext, NotFoundError } from '@ecokart/core'
import { notFound } from 'next/navigation'
import { DocumentReviewManager } from '@/components/admin/document-review-manager'
import { PageHeader } from '@/components/ui/page-header'
import { requireAdminPageContext } from '@/lib/page-auth'
import { getDatabase } from '@/lib/db'
import type { SellerDocument } from '@/lib/seller-documents'

export const metadata = { title: 'Review seller document' }
export const instant = false
export default async function ReviewPage({
  params,
}: PageProps<'/admin/seller-documents/[id]'>) {
  const context = await requireAdminPageContext('/admin/seller-documents')
  const { id } = await params
  let document
  try {
    document = await withContext(getDatabase(), context, (tx) =>
      getDocumentRequest(tx, context, id),
    )
  } catch (cause) {
    if (cause instanceof NotFoundError) notFound()
    throw cause
  }
  const serialised: SellerDocument = {
    ...document,
    requestedAt: document.requestedAt.toISOString(),
    acceptedAt: document.acceptedAt?.toISOString() ?? null,
    cancelledAt: document.cancelledAt?.toISOString() ?? null,
    files: document.files.map((file) => ({
      ...file,
      uploadedAt: file.uploadedAt.toISOString(),
      reviewedAt: file.reviewedAt?.toISOString() ?? null,
    })),
  }
  return (
    <div className="grid gap-7">
      <PageHeader
        title="Review seller document"
        description="Private verification request and file history."
      />
      <DocumentReviewManager initialDocument={serialised} />
    </div>
  )
}
