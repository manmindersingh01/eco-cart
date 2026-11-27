import type { ReactNode } from 'react'
import { LinkButton } from './button'
import { Card } from './feedback'
import type { PortalTool } from '@/lib/portal-tools'

export function PortalTools({
  tools,
  badges = {},
}: {
  tools: readonly PortalTool[]
  badges?: Readonly<Record<string, ReactNode>>
}) {
  return (
    <section aria-labelledby="available-tools">
      <h2 id="available-tools" className="text-xl font-semibold">
        Available tools
      </h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tools.map((tool) => (
          <Card key={tool.href} className="flex min-w-0 flex-col items-start">
            <div className="flex w-full items-start justify-between gap-3">
              <h3 className="text-lg font-semibold">{tool.label}</h3>
              {badges[tool.href]}
            </div>
            <p className="mt-2 flex-1 text-sm text-muted">{tool.description}</p>
            <LinkButton href={tool.href} className="mt-5">
              {tool.action}
            </LinkButton>
          </Card>
        ))}
      </div>
    </section>
  )
}
