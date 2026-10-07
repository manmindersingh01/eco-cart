'use client'

import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/feedback'

export default function ErrorPage({
  reset,
}: {
  error: Error
  reset: () => void
}) {
  return (
    <main id="main-content" className="page-container flex-1 py-12">
      <Notice title="This page could not be loaded" tone="danger">
        <p>
          Please try again. If the problem continues, return to the previous
          page.
        </p>
        <Button className="mt-4" variant="secondary" onClick={reset}>
          Try again
        </Button>
      </Notice>
    </main>
  )
}
