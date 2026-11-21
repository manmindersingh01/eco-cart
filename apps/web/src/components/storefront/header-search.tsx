'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { SearchBox } from './search-box'

/**
 * The header's search box. On the search page it keeps the words searched
 * for, so the buyer can change them in place; the page has no second box.
 */
export function HeaderSearch({
  id,
  className,
}: {
  id: string
  className?: string
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const keyword = pathname === '/search' ? (searchParams.get('q') ?? '') : ''
  // The key starts the uncontrolled input again when the search changes.
  return (
    <SearchBox
      key={keyword}
      id={id}
      defaultValue={keyword}
      className={className}
    />
  )
}
