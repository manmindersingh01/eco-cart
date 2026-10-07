import { AccountControls } from '@/components/auth/account-controls'
import { PortalShell } from '@/components/ui/portal-shell'
import { requireSellerPage } from '@/lib/page-auth'

const navigation = [{ href: '/seller', label: 'Overview' }] as const

export default async function SellerLayout({
  children,
}: LayoutProps<'/seller'>) {
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
