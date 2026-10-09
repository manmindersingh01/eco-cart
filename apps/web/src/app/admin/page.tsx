import { LinkButton } from '@/components/ui/button'
import { Card } from '@/components/ui/feedback'
import { PageHeader } from '@/components/ui/page-header'

export default function AdminPage() {
  return (
    <div className="grid gap-8">
      <PageHeader
        title="Administrator portal"
        description="Manage the EcoKart marketplace from one place."
      />
      <section aria-labelledby="available-tools">
        <h2 id="available-tools" className="text-xl font-semibold">
          Available tools
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Card className="flex flex-col items-start">
            <h3 className="text-lg font-semibold">Platform settings</h3>
            <p className="mt-2 flex-1 text-sm text-muted">
              Manage commerce values, payment options, AI limits, moderation
              terms, and company details.
            </p>
            <LinkButton href="/admin/settings" className="mt-5">
              Manage settings
            </LinkButton>
          </Card>
          <Card className="flex flex-col items-start">
            <h3 className="text-lg font-semibold">Sellers</h3>
            <p className="mt-2 flex-1 text-sm text-muted">
              Create seller accounts, maintain business details, and manage
              approval or suspension.
            </p>
            <LinkButton href="/admin/sellers" className="mt-5">
              Manage sellers
            </LinkButton>
          </Card>
        </div>
      </section>
    </div>
  )
}
