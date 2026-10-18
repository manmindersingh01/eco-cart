'use client'

import './globals.css'
import { Button, LinkButton } from '@/components/ui/button'

export default function GlobalError({
  retry,
}: {
  error: Error
  retry: () => void
}) {
  return (
    <html lang="en-IN">
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <main className="page-container flex min-h-screen items-center py-16">
          <div className="mx-auto w-full max-w-2xl rounded-xl border bg-surface p-7 text-center shadow-[var(--shadow-card)] sm:p-10">
            <h1 className="text-3xl font-semibold">
              EcoKart could not start this page
            </h1>
            <p className="mt-3 text-muted">
              Please try again. If the problem continues, return to the EcoKart
              home page.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Button onClick={retry}>Try again</Button>
              <LinkButton href="/" variant="secondary">
                Return home
              </LinkButton>
            </div>
          </div>
        </main>
      </body>
    </html>
  )
}
