import Link from 'next/link'
import { Suspense } from 'react'
import { AccountControls } from '@/components/auth/account-controls'
import { CartLink } from '@/components/storefront/cart-link'
import { CategoryNavigation } from '@/components/storefront/category-navigation'
import { SearchBox } from '@/components/storefront/search-box'
import { Skeleton } from '@/components/ui/feedback'

export default function StorefrontLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="flex min-h-full min-w-0 flex-1 flex-col overflow-x-clip">
      <header className="min-w-0 border-b bg-surface">
        {/* Phone: the logo and account in one row, search and cart below.
            Wider: one row of logo, search, account, and cart. */}
        <div className="page-container flex min-h-16 flex-wrap items-center gap-x-4 gap-y-3 py-3">
          <Link
            href="/"
            className="order-1 inline-flex items-center gap-2 rounded-md font-semibold text-brand-strong"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="size-7 text-brand"
              fill="currentColor"
            >
              <path d="M20 4c-9 0-15 4.5-15 11.5 0 1.6.4 3 1 4.2C8 14 12 10.5 16 8.5c-3.5 2.5-6.6 6-8.4 11.2 1.1.5 2.3.8 3.6.8C18 20.5 20 13 20 4z" />
            </svg>
            <span className="text-xl">EcoKart</span>
          </Link>
          <div className="order-2 ml-auto md:order-3 md:ml-0">
            <AccountControls compact />
          </div>
          <SearchBox
            id="header-search"
            className="order-3 w-[calc(100%-3.75rem)] md:order-2 md:w-auto md:max-w-xl md:flex-1"
          />
          <div className="order-4">
            <CartLink />
          </div>
        </div>
        <Suspense
          fallback={
            <div className="border-t">
              <div className="page-container flex min-h-12 items-center gap-4">
                <span className="sr-only">Loading catalogue navigation</span>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-5 w-40" />
              </div>
            </div>
          }
        >
          <CategoryNavigation />
        </Suspense>
      </header>
      {children}
      <footer className="mt-auto border-t bg-surface">
        <div className="page-container py-6 text-sm text-muted">
          EcoKart connects buyers with independent sellers across India.
        </div>
      </footer>
    </div>
  )
}
