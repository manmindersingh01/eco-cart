import type { Metadata } from 'next'
import { LinkButton } from '@/components/ui/button'
import { Notice } from '@/components/ui/feedback'
import { PageHeader } from '@/components/ui/page-header'

export const metadata: Metadata = {
  title: 'Access denied',
}

type AccessDeniedPageProps = {
  searchParams: Promise<{
    area?: string | string[]
    reason?: string | string[]
  }>
}

function firstValue(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

export default async function AccessDeniedPage({
  searchParams,
}: AccessDeniedPageProps) {
  const query = await searchParams
  const area = firstValue(query.area) === 'seller' ? 'seller' : 'administrator'
  const sellerNotReady = firstValue(query.reason) === 'seller-not-ready'

  return (
    <main id="main-content" className="page-container flex-1 py-12">
      <div className="mx-auto grid max-w-2xl gap-6">
        <PageHeader
          title="Access denied"
          description={`This page needs a signed-in ${area} account.`}
        />
        <Notice tone="warning" title="Your account cannot open this area">
          {sellerNotReady
            ? 'This seller account is not set up yet. Ask an administrator to complete its business record.'
            : `Your current account does not have ${area} access.`}
        </Notice>
        <div className="flex flex-wrap gap-3">
          <LinkButton href="/" variant="secondary">
            Return to EcoKart
          </LinkButton>
          <LinkButton href="/sign-in">Use another account</LinkButton>
        </div>
      </div>
    </main>
  )
}
