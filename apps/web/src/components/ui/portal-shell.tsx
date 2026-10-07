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
  children,
}: {
  portalName: string
  navigation: readonly NavigationItem[]
  children: ReactNode
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-background lg:flex-row">
      <aside className="border-b bg-surface lg:w-64 lg:border-r lg:border-b-0">
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
      <main id="main-content" className="min-w-0 flex-1">
        <div className="page-container py-6 sm:py-8">{children}</div>
      </main>
    </div>
  )
}
