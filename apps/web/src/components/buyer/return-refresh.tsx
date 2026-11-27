'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'

export function ReturnRefresh() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? 'Refreshing...' : 'Refresh return'}
    </Button>
  )
}
