import { Skeleton } from '@/components/ui/feedback'

export default function Loading() {
  return (
    <main
      id="main-content"
      className="page-container flex-1 py-8"
      aria-busy="true"
    >
      <span className="sr-only">Loading page</span>
      <div className="grid gap-4">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-5 w-full max-w-xl" />
        <Skeleton className="mt-4 h-52 w-full" />
      </div>
    </main>
  )
}
