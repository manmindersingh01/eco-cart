import { Skeleton } from '@/components/ui/feedback'

export default function SellerLoading() {
  return (
    <div className="grid gap-6" aria-busy="true">
      <span className="sr-only">Loading seller page</span>
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-5 w-full max-w-xl" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}
