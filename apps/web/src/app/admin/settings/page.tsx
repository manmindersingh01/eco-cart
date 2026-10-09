import { listSettings, withContext } from '@ecokart/core'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { SettingsEditor } from '@/components/admin/settings-editor'
import { Notice } from '@/components/ui/feedback'
import { PageHeader } from '@/components/ui/page-header'
import type { AdminSetting } from '@/lib/admin-settings'
import { getDatabase } from '@/lib/db'
import { requireAdmin } from '@/lib/request-context'

export const metadata: Metadata = {
  title: 'Platform settings | EcoKart',
}

export const dynamic = 'force-dynamic'

export default async function AdminSettingsPage() {
  const requestHeaders = await headers()
  const { context } = await requireAdmin(requestHeaders)
  const settings = await withContext(getDatabase(), context, (tx) =>
    listSettings(tx, context),
  )
  const serialised: AdminSetting[] = settings.map((setting) => ({
    ...setting,
    updatedAt: setting.updatedAt?.toISOString() ?? null,
  }))
  const missingCount = serialised.filter(
    (setting) => setting.source === 'missing',
  ).length

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Platform settings"
        description="Save each setting separately. Changes take effect on the next request and are recorded in the administrator audit log."
      />
      {missingCount > 0 ? (
        <Notice title="Setup is incomplete" tone="warning">
          {missingCount === 1
            ? 'One client-provided value is missing.'
            : `${missingCount} client-provided values are missing.`}{' '}
          Features that depend on a missing value will wait until an
          administrator saves it.
        </Notice>
      ) : null}
      <nav aria-label="Settings sections" className="overflow-x-auto">
        <ul className="flex min-w-max gap-2">
          {[
            ['commerce', 'Commerce'],
            ['payments', 'Payments'],
            ['ai-limits', 'AI limits'],
            ['moderation', 'Moderation'],
            ['company', 'Company details'],
          ].map(([id, label]) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className="inline-flex min-h-11 items-center rounded-lg border bg-surface px-3 text-sm font-medium hover:border-brand hover:text-brand-strong"
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <SettingsEditor settings={serialised} />
    </div>
  )
}
