import type { Metadata } from 'next'
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

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const query = await searchParams
  const returnTo = safeReturnTo(firstValue(query.returnTo))
  const reason = firstValue(query.reason)

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
        <SignInForm returnTo={returnTo} reason={reason} />
      </Card>
    </main>
  )
}
