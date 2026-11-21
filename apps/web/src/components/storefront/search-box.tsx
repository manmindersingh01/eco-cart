import Form from 'next/form'
import { cx } from '@/lib/classes'

/**
 * Keyword search: a GET form to /search, so it works before scripts load
 * and its results have an address to share.
 */
export function SearchBox({
  defaultValue = '',
  id = 'search-page-query',
  className,
}: {
  defaultValue?: string
  id?: string
  className?: string
}) {
  return (
    <search className={cx('min-w-0', className)}>
      <Form action="/search" className="flex w-full min-w-0 items-center gap-2">
        <label htmlFor={id} className="sr-only">
          Search products
        </label>
        <input
          id={id}
          type="search"
          name="q"
          defaultValue={defaultValue}
          placeholder="Search products, brands, materials"
          maxLength={100}
          required
          className="min-h-11 w-full min-w-0 flex-1 rounded-lg border bg-surface px-3 py-2 text-foreground shadow-sm placeholder:text-muted/75"
        />
        <button
          type="submit"
          aria-label="Search"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand text-white hover:bg-brand-strong"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="9" cy="9" r="5.5" />
            <path d="m13.5 13.5 3.5 3.5" />
          </svg>
        </button>
      </Form>
    </search>
  )
}
