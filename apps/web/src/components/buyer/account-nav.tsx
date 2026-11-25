import Link from 'next/link'
import { cx } from '@/lib/classes'

const LINKS = [
  { href: '/account/orders', label: 'Orders' },
  { href: '/account/returns', label: 'Returns' },
  { href: '/account/addresses', label: 'Addresses' },
  { href: '/account/seller-application', label: 'Sell on EcoKart' },
] as const

/** The buyer's account sections, as tabs above each account page. */
export function AccountNav({
  current,
}: {
  current: (typeof LINKS)[number]['href']
}) {
  return (
    <nav aria-label="Your account" className="overflow-x-auto border-b">
      <ul className="flex gap-1">
        {LINKS.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              aria-current={link.href === current ? 'page' : undefined}
              className={cx(
                'inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-semibold whitespace-nowrap',
                link.href === current
                  ? 'border-brand text-brand-strong'
                  : 'border-transparent text-muted hover:text-foreground',
              )}
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
