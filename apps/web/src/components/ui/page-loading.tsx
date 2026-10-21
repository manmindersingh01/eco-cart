import { Skeleton } from '@/components/ui/feedback'

/*
 * Placeholders for the part of a page that reads the request (the session
 * or the query string). Pages keep their title and other fixed parts
 * outside <Suspense>, so a navigation shows them at once (Next.js instant
 * navigations), and show one of these where the rest streams in.
 */

/** A whole page body: a title, a line of text, and a block. */
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

/** The content under a page's title: a row of filters and a list. */
export function ContentLoading() {
  return (
    <div className="grid gap-4" aria-busy="true">
      <span className="sr-only">Loading</span>
      <Skeleton className="h-11 w-full max-w-md" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  )
}

/** A one-field form with its button. */
export function FormLoading() {
  return (
    <div className="grid gap-4" aria-busy="true">
      <span className="sr-only">Loading</span>
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
    </div>
  )
}
