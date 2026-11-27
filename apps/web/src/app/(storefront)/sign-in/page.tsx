import type { Metadata } from 'next'
import { loadAuthConfig } from '@ecokart/core'
import { Suspense } from 'react'
import Loading from '../../loading'
import { SignInForm } from '@/components/auth/sign-in-form'
import { Card } from '@/components/ui/feedback'
import { safeReturnTo } from '@/lib/auth-routing'

export const metadata: Metadata = {
  title: 'Sign in',
}

type SignInPageProps = {
  searchParams: Promise<{
    returnTo?: string | string[]
    reason?: string | string[]
  }>
}

function firstValue(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

export default function SignInPage(props: SignInPageProps) {
  return (
    <Suspense fallback={<Loading />}>
      <SignInContent {...props} />
    </Suspense>
  )
}

async function SignInContent({ searchParams }: SignInPageProps) {
  const query = await searchParams
  const returnTo = safeReturnTo(firstValue(query.returnTo))
  const reason = firstValue(query.reason)
  const phoneEnabled = loadAuthConfig().smsOtpEnabled

  return (
    <main
      id="main-content"
      className="page-container flex flex-1 items-center py-12 sm:py-20"
    >
      <Card className="mx-auto w-full max-w-md p-6 sm:p-8">
        <div className="mb-7">
          <h1 className="text-2xl font-semibold tracking-tight">
            Sign in to EcoKart
          </h1>
          <p className="mt-2 text-sm text-muted">
            Use the one-time code sent to your email address
            {phoneEnabled ? ' or Indian mobile number' : ''}.
          </p>
        </div>
        <SignInForm
          returnTo={returnTo}
          reason={reason}
          phoneEnabled={phoneEnabled}
        />
      </Card>
    </main>
  )
}
