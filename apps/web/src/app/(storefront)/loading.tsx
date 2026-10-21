import { Skeleton } from '@/components/ui/feedback'

export default function StorefrontLoading() {
  return (
    <main
      id="main-content"
      className="page-container flex-1 py-12"
      aria-busy="true"
    >
      <span className="sr-only">Loading EcoKart</span>
      <div className="grid gap-6">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-14 w-full max-w-3xl" />
        <Skeleton className="h-6 w-full max-w-2xl" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    </main>
  )
}
