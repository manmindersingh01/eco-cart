import {
  getAiUsage,
  listSearchGaps,
  ValidationError,
  withContext,
} from '@ecokart/core'
import { Button, LinkButton } from '@/components/ui/button'
import { Card, EmptyState, Notice } from '@/components/ui/feedback'
import { Field, Input } from '@/components/ui/form-controls'
import { formatAiCost } from '@/lib/assistant-report'
import { getDatabase } from '@/lib/db'
import { formatIndianDate } from '@/lib/format'
import { requireAdminPageContext } from '@/lib/page-auth'
export async function AiUsageReportContent({
  searchParams,
}: PageProps<'/admin/ai'>) {
  const context = await requireAdminPageContext('/admin/ai')
  const raw = await searchParams
  const value = (key: string) =>
    (Array.isArray(raw[key]) ? raw[key].at(-1) : raw[key]) || undefined
  let report
  let problem = ''
  try {
    report = await withContext(getDatabase(), context, (tx) =>
      getAiUsage(tx, context, { from: value('from'), to: value('to') }),
    )
  } catch (cause) {
    problem =
      cause instanceof ValidationError
        ? 'Choose real dates, with From no later than To and a range of at most 92 days.'
        : 'The AI usage report is unavailable. Refresh to try again.'
  }
  return (
    <>
      <form
        action="/admin/ai"
        className="flex flex-wrap items-end gap-3"
        aria-label="AI usage dates"
      >
        <Field label="From (India date)" htmlFor="usage-from">
          <Input
            name="from"
            type="date"
            defaultValue={report?.from ?? value('from') ?? ''}
          />
        </Field>
        <Field label="To (India date)" htmlFor="usage-to">
          <Input
            name="to"
            type="date"
            defaultValue={report?.to ?? value('to') ?? ''}
          />
        </Field>
        <Button type="submit">Apply dates</Button>
        <LinkButton href="/admin/ai" variant="secondary">
          Reset dates
        </LinkButton>
      </form>
      {problem ? (
        <Notice tone="danger" title="AI usage could not be shown">
          {problem}
        </Notice>
      ) : null}
      {report ? (
        <>
          <Card className="grid gap-3">
            <h2 className="text-lg font-semibold">
              Today's platform allowance
            </h2>
            <p>{report.today.date} (India)</p>
            <p>
              {report.today.platformCalls.toLocaleString('en-IN')} /{' '}
              {report.today.platformLimit.toLocaleString('en-IN')} calls
            </p>
            <p className="text-sm text-muted">
              Today's allowance is separate from the report range. Embeddings
              and other features excluded by the service's limit rules are not
              part of this count.
            </p>
          </Card>
          <p className="text-sm text-muted">
            Costs are US dollars, not rupees. One million micro-USD equals USD
            1. A missing provider cost is shown as Not reported, not zero.
          </p>
          <section aria-label="AI usage entries" className="grid gap-4">
            <h2 className="text-xl font-semibold">
              Usage from {report.from} to {report.to}
            </h2>
            {report.lines.length ? (
              <ul className="grid gap-4 sm:grid-cols-2">
                {report.lines.map((line) => (
                  <li key={`${line.date}-${line.feature}`}>
                    <Card className="grid h-full gap-3">
                      <h3 className="font-semibold break-words">
                        {line.date} · {line.feature}
                      </h3>
                      <dl className="grid gap-2 text-sm">
                        <div>
                          <dt className="text-muted">Calls</dt>
                          <dd>{line.calls.toLocaleString('en-IN')}</dd>
                        </div>
                        <div>
                          <dt className="text-muted">Failed calls</dt>
                          <dd>{line.failedCalls.toLocaleString('en-IN')}</dd>
                        </div>
                        <div>
                          <dt className="text-muted">Input / output tokens</dt>
                          <dd>
                            {line.inputTokens.toLocaleString('en-IN')} /{' '}
                            {line.outputTokens.toLocaleString('en-IN')}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted">Reported cost</dt>
                          <dd>{formatAiCost(line.costMicroUsd)}</dd>
                        </div>
                      </dl>
                    </Card>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title="No AI calls in this range"
                description="Days and features without calls are not listed."
              />
            )}
          </section>
        </>
      ) : null}
    </>
  )
}

export async function SearchGapsReportContent({
  searchParams,
}: PageProps<'/admin/search-gaps'>) {
  const context = await requireAdminPageContext('/admin/search-gaps')
  const raw = await searchParams
  const days = (Array.isArray(raw.days) ? raw.days.at(-1) : raw.days) || '30'
  let gaps
  let problem = ''
  try {
    gaps = await withContext(getDatabase(), context, (tx) =>
      listSearchGaps(tx, context, { days }),
    )
  } catch (cause) {
    problem =
      cause instanceof ValidationError
        ? 'Choose a whole number of days from 1 to 90.'
        : 'The search-gap report is unavailable. Refresh to try again.'
  }
  return (
    <>
      <form
        action="/admin/search-gaps"
        className="flex flex-wrap items-end gap-3"
        aria-label="Search gap period"
      >
        <Field label="Past days" htmlFor="gap-days">
          <Input
            type="number"
            name="days"
            min={1}
            max={90}
            step={1}
            defaultValue={days}
            required
          />
        </Field>
        <Button type="submit">Apply period</Button>
      </form>
      {problem ? (
        <Notice tone="danger" title="Search gaps could not be shown">
          {problem}
        </Notice>
      ) : null}
      {gaps ? (
        <section aria-label="Zero-result queries" className="grid gap-4">
          <h2 className="text-xl font-semibold">Past {Number(days)} days</h2>
          {gaps.length ? (
            <ul className="grid gap-4 sm:grid-cols-2">
              {gaps.map((gap) => (
                <li key={gap.query}>
                  <Card className="grid h-full min-w-0 gap-3">
                    <h3 className="font-semibold break-words">{gap.query}</h3>
                    <p>{gap.searches.toLocaleString('en-IN')} searches</p>
                    <p className="text-sm text-muted">
                      Last searched:{' '}
                      {formatIndianDate(gap.lastSearchedAt, {
                        includeTime: true,
                      })}
                    </p>
                  </Card>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No search gaps in this period"
              description="There are no recorded text searches without results in this period."
            />
          )}
        </section>
      ) : null}
    </>
  )
}
