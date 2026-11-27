import { AccountControls } from '@/components/auth/account-controls'
import { PortalShell } from '@/components/ui/portal-shell'
import { requireAdminPage } from '@/lib/page-auth'
import { adminNavigation } from '@/lib/portal-tools'
import { Suspense } from 'react'
import Loading from '../loading'

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
      navigation={adminNavigation}
      accountActions={<AccountControls initialAccount={account} />}
    >
      {children}
    </PortalShell>
  )
}
