import { AccountControls } from '@/components/auth/account-controls'
import { PortalShell } from '@/components/ui/portal-shell'
import { requireAdminPage } from '@/lib/page-auth'

const navigation = [{ href: '/admin', label: 'Overview' }] as const

export default async function AdminLayout({ children }: LayoutProps<'/admin'>) {
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
