import type { Metadata } from 'next'
import { Suspense } from 'react'
import { SignInForm } from '@/components/auth/sign-in-form'
import { Card } from '@/components/ui/feedback'
import { FormLoading } from '@/components/ui/page-loading'
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

/** The form, which needs where to go back to and why sign-in was asked for. */
async function SignInFromQuery({ searchParams }: SignInPageProps) {
  const query = await searchParams
  return (
    <SignInForm
      returnTo={safeReturnTo(firstValue(query.returnTo))}
      reason={firstValue(query.reason)}
    />
  )
}

export default function SignInPage({ searchParams }: SignInPageProps) {
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
            Use the one-time code sent to your email address.
          </p>
        </div>
        <Suspense fallback={<FormLoading />}>
          <SignInFromQuery searchParams={searchParams} />
        </Suspense>
      </Card>
    </main>
  )
}
