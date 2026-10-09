import type { Metadata } from 'next'
import { NewSellerForm } from '@/components/admin/new-seller-form'
import { LinkButton } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'

export const metadata: Metadata = {
  title: 'Create seller | EcoKart',
}

export default function NewSellerPage() {
  return (
    <div className="grid gap-7">
      <PageHeader
        title="Create seller"
        description="Create a pending business and its owner's seller sign-in account. Tax details may be added later, but both GSTIN and PAN are required for approval."
        actions={
          <LinkButton href="/admin/sellers" variant="secondary">
            Back to sellers
          </LinkButton>
        }
      />
      <NewSellerForm />
    </div>
  )
}
