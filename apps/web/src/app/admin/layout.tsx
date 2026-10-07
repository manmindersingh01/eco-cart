import { PortalShell } from '@/components/ui/portal-shell'

const navigation = [{ href: '/admin', label: 'Overview' }] as const

export default function AdminLayout({ children }: LayoutProps<'/admin'>) {
  return (
    <PortalShell portalName="Administrator portal" navigation={navigation}>
      {children}
    </PortalShell>
  )
}
