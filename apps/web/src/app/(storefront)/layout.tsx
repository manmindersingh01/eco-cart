import Link from 'next/link'

export default function StorefrontLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b bg-surface">
        <div className="page-container flex min-h-16 items-center justify-between gap-4 py-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-md font-semibold text-brand-strong"
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
          <p className="text-sm text-muted">Marketplace for India</p>
        </div>
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
