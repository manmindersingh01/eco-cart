import {
  ForbiddenError,
  getOwnApplication,
  NotFoundError,
  rolesOf,
} from '@ecokart/core'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { SellerApplicationManager } from '@/components/account/seller-application-manager'
import { Notice } from '@/components/ui/feedback'
import { PageHeader } from '@/components/ui/page-header'
import { ContentLoading } from '@/components/ui/page-loading'
import { getDatabase } from '@/lib/db'
import { getRequestContext } from '@/lib/request-context'
import type { SellerApplication } from '@/lib/seller-application'

export const metadata: Metadata = {
  title: 'Become a seller',
}

export default function SellerApplicationPage() {
  return (
    <main id="main-content" className="page-container flex-1 py-8 sm:py-12">
      <div className="mx-auto grid max-w-4xl gap-7">
        <PageHeader
          title="Become a seller"
          description="Sell your products to buyers across India from the account you already shop with."
        />
        {/* The session is read per request, so it streams in after the title. */}
        <Suspense fallback={<ContentLoading />}>
          <Application />
        </Suspense>
      </div>
    </main>
  )
}

async function Application() {
  const requestHeaders = await headers()
  let resolved
  try {
    resolved = await getRequestContext(requestHeaders)
  } catch (cause) {
    // For example a seller account whose business is suspended.
    if (cause instanceof ForbiddenError) {
      return <Notice tone="warning" title={cause.message} />
    }
    throw cause
  }
  const { session, context } = resolved
  if (!session) {
    redirect('/sign-in?returnTo=%2Faccount%2Fseller-application')
  }
  if (context.role === 'admin') {
    return (
      <Notice tone="warning" title="Administrator accounts cannot apply">
        Sign in with your own buyer account to apply to sell.
      </Notice>
    )
  }

  let application: SellerApplication | null = null
  try {
    const view = await getOwnApplication(getDatabase(), context)
    application = {
      ...view,
      approvedAt: view.approvedAt?.toISOString() ?? null,
      createdAt: view.createdAt.toISOString(),
      updatedAt: view.updatedAt.toISOString(),
    }
  } catch (cause) {
    if (!(cause instanceof NotFoundError)) throw cause
  }

  return (
    <SellerApplicationManager
      initialApplication={application}
      canApply={rolesOf(session.user.role).includes('buyer')}
    />
  )
}
