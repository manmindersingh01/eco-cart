import { AccountControls } from '@/components/auth/account-controls'
import { PortalShell } from '@/components/ui/portal-shell'
import { requireAdminPage } from '@/lib/page-auth'
import { Suspense } from 'react'
import Loading from '../loading'

const navigation = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/settings', label: 'Platform settings' },
  { href: '/admin/sellers', label: 'Sellers' },
  { href: '/admin/seller-documents', label: 'Document review' },
  { href: '/admin/moderation', label: 'Listing review' },
  { href: '/admin/categories', label: 'Categories' },
  { href: '/admin/brands', label: 'Brands' },
] as const

// Entering a protected area may block on the server's session decision.
export const instant = false

export default function AdminLayout(props: LayoutProps<'/admin'>) {
  return (
    <Suspense fallback={<Loading />}>
      <AdminAccess {...props} />
    </Suspense>
  )
}

async function AdminAccess({ children }: LayoutProps<'/admin'>) {
  const account = await requireAdminPage('/admin')
  return (
    <PortalShell
      portalName="Administrator portal"
      navigation={navigation}
      accountActions={<AccountControls initialAccount={account} />}
    >
      {children}
    </PortalShell>
  )
}
