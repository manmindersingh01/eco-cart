import { AccountControls } from '@/components/auth/account-controls'
import { PortalShell } from '@/components/ui/portal-shell'
import { requireSellerPage } from '@/lib/page-auth'
import { sellerNavigation } from '@/lib/portal-tools'
import { Suspense } from 'react'
import Loading from '../loading'

// Entering a protected area may block on the server's session decision.
export const instant = false

export default function SellerLayout(props: LayoutProps<'/seller'>) {
  return (
    <Suspense fallback={<Loading />}>
      <SellerAccess {...props} />
    </Suspense>
  )
}

async function SellerAccess({ children }: LayoutProps<'/seller'>) {
  const account = await requireSellerPage('/seller')
  return (
    <PortalShell
      portalName="Seller portal"
      navigation={sellerNavigation}
      accountActions={<AccountControls initialAccount={account} />}
    >
      {children}
    </PortalShell>
  )
}
