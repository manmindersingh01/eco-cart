'use client'

import { Button, LinkButton } from '@/components/ui/button'
import { Notice } from '@/components/ui/feedback'

export default function ErrorPage({
  retry,
}: {
  error: Error
  retry: () => void
}) {
  return (
    <main id="main-content" className="page-container flex-1 py-12">
      <Notice title="This page could not be loaded" tone="danger">
        <p>
          Please try again. If the problem continues, return to the previous
          page.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button variant="secondary" onClick={retry}>
            Try again
          </Button>
          <LinkButton href="/">Return to EcoKart</LinkButton>
        </div>
      </Notice>
    </main>
  )
}
