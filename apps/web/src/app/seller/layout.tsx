import { PortalShell } from '@/components/ui/portal-shell'

const navigation = [{ href: '/seller', label: 'Overview' }] as const

export default function SellerLayout({ children }: LayoutProps<'/seller'>) {
  return (
    <PortalShell portalName="Seller portal" navigation={navigation}>
      {children}
    </PortalShell>
  )
}
