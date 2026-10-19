import { Skeleton } from '@/components/ui/feedback'

/**
 * The placeholder a page shows while it reads its request (the session or
 * the query string). Each area's loading.tsx puts it inside the area's own
 * layout, so moving between pages shows the navigation at once.
 */
export function PageLoading() {
  return (
    <div className="grid gap-4" aria-busy="true">
      <span className="sr-only">Loading page</span>
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-5 w-full max-w-xl" />
      <Skeleton className="mt-4 h-52 w-full" />
    </div>
  )
}
