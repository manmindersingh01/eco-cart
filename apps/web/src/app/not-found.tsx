import type { Metadata } from 'next'
import { LinkButton } from '@/components/ui/button'
import { Card } from '@/components/ui/feedback'

export const metadata: Metadata = {
  title: 'Page not found',
}

export default function NotFound() {
  return (
    <main
      id="main-content"
      className="page-container flex flex-1 items-center py-16 sm:py-24"
    >
      <Card className="mx-auto w-full max-w-2xl p-7 text-center sm:p-10">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-strong">
          Error 404
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          This page is not available
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-muted">
          The address may be incorrect, or the page may belong to a later
          EcoKart release.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <LinkButton href="/">Return to EcoKart</LinkButton>
          <LinkButton href="/sign-in" variant="secondary">
            Sign in
          </LinkButton>
        </div>
      </Card>
    </main>
  )
}
