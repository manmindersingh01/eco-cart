import { AccountControls } from '@/components/auth/account-controls'
import { PortalShell } from '@/components/ui/portal-shell'
import { requireSellerPage } from '@/lib/page-auth'
import { Suspense } from 'react'
import Loading from '../loading'

const navigation = [
  { href: '/seller', label: 'Overview' },
  { href: '/seller/profile', label: 'Business profile' },
  { href: '/seller/products', label: 'Products' },
] as const

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
      navigation={navigation}
      accountActions={<AccountControls initialAccount={account} />}
    >
      {children}
    </PortalShell>
  )
}
