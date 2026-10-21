import type { Route } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'

type NavigationItem = {
  href: Route
  label: string
}

export function PortalShell({
  portalName,
  navigation,
  accountActions,
  children,
}: {
  portalName: string
  navigation: readonly NavigationItem[]
  accountActions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-background lg:flex-row">
      {/* On desktop the navigation stays in view on long pages. */}
      <aside className="border-b bg-surface lg:sticky lg:top-0 lg:h-dvh lg:w-64 lg:shrink-0 lg:self-start lg:overflow-y-auto lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between gap-4 px-4 py-4 lg:block lg:px-6 lg:py-6">
          <Link
            href="/"
            className="rounded-md text-xl font-semibold text-brand-strong"
          >
            EcoKart
          </Link>
          <span className="text-sm font-medium text-muted lg:mt-1 lg:block">
            {portalName}
          </span>
        </div>
        <nav
          aria-label={`${portalName} navigation`}
          className="overflow-x-auto px-3 pb-3 lg:px-4"
        >
          <ul className="flex min-w-max gap-1 lg:min-w-0 lg:flex-col">
            {navigation.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block rounded-lg px-3 py-2.5 text-sm font-medium text-muted hover:bg-brand-soft hover:text-brand-strong"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b bg-surface">
          <div className="page-container flex min-h-16 items-center justify-between gap-3 py-2">
            <Link
              href="/"
              aria-label="Back to shop"
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg text-sm font-semibold text-brand-strong underline-offset-4 hover:underline"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12.5 4.5 7 10l5.5 5.5" />
              </svg>
              <span className="sm:hidden">Shop</span>
              <span className="max-sm:hidden">Back to shop</span>
            </Link>
            {accountActions}
          </div>
        </header>
        <main id="main-content" className="flex-1">
          <div className="page-container py-6 sm:py-8">{children}</div>
        </main>
      </div>
    </div>
  )
}
