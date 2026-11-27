import {
  listFailedJobs,
  listUndeliveredEmails,
  QUEUES,
  withContext,
} from '@ecokart/core'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { BackgroundRetry } from '@/components/admin/background-retry'
import { EarningsRefresh } from '@/components/seller/earnings-refresh'
import { Button, LinkButton } from '@/components/ui/button'
import { Card, EmptyState, Notice } from '@/components/ui/feedback'
import { Field, Select } from '@/components/ui/form-controls'
import { PageHeader } from '@/components/ui/page-header'
import { ContentLoading } from '@/components/ui/page-loading'
import { getDatabase } from '@/lib/db'
import { QueueCounts } from '@/components/admin/queue-counts'
import { requireAdminPageContext } from '@/lib/page-auth'
import { formatIndianDate } from '@/lib/format'

export const metadata: Metadata = {
  title: 'Background work',
  robots: { index: false },
}
export const instant = false
type Query = {
  view: 'jobs' | 'emails'
  queue: string
  state: string
  cursor?: string
}
function queryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.at(-1) : value
}
function queryFor(query: Query, cursor?: string) {
  return {
    pathname: '/admin/background-work' as const,
    query: {
      view: query.view,
      ...(query.view === 'jobs'
        ? { queue: query.queue }
        : query.state
          ? { state: query.state }
          : {}),
      ...(cursor ? { cursor } : {}),
    },
  }
}
export default function BackgroundWorkPage(
  props: PageProps<'/admin/background-work'>,
) {
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Background work"
        description="Check queues and retry failed jobs or undelivered emails. Counts may trail by about a minute. Lists show current records."
        actions={<EarningsRefresh label="Refresh background work" />}
      />
      <details className="rounded-xl border bg-surface p-4">
        <summary className="cursor-pointer py-2 font-semibold">
          Show queue counts
        </summary>
        <Suspense fallback={<ContentLoading />}>
          <QueueCounts />
        </Suspense>
      </details>
      <Suspense fallback={<ContentLoading />}>
        <WorkLists {...props} />
      </Suspense>
    </div>
  )
}
async function WorkLists({
  searchParams,
}: PageProps<'/admin/background-work'>) {
  const context = await requireAdminPageContext('/admin/background-work')
  const raw = await searchParams
  const view = queryValue(raw.view) ?? 'jobs'
  const queue = queryValue(raw.queue) ?? QUEUES[0]!.name
  const state = queryValue(raw.state) ?? ''
  const cursor = queryValue(raw.cursor)
  if (
    !['jobs', 'emails'].includes(view) ||
    !QUEUES.some((item) => item.name === queue) ||
    !['', 'failed', 'stuck'].includes(state)
  )
    return (
      <Notice tone="danger" title="These filters are not valid">
        <LinkButton href="/admin/background-work">Reset filters</LinkButton>
      </Notice>
    )
  const query: Query = {
    view: view === 'emails' ? 'emails' : 'jobs',
    queue,
    state,
    cursor,
  }
  return (
    <section aria-label="Background work lists" className="grid gap-4">
      <h2 className="text-xl font-semibold">
        {query.view === 'jobs' ? 'Failed jobs' : 'Undelivered emails'}
      </h2>
      <nav aria-label="Work type" className="flex flex-wrap gap-3">
        <LinkButton
          variant="secondary"
          href={queryFor({ ...query, view: 'jobs' })}
        >
          Failed jobs
        </LinkButton>
        <LinkButton
          variant="secondary"
          href={queryFor({ ...query, view: 'emails' })}
        >
          Undelivered emails
        </LinkButton>
      </nav>
      <form
        action="/admin/background-work"
        className="flex flex-wrap items-end gap-3"
      >
        <input type="hidden" name="view" value={query.view} />
        {query.view === 'jobs' ? (
          <Field label="Queue" htmlFor="work-queue">
            <Select name="queue" defaultValue={queue}>
              {QUEUES.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Email state" htmlFor="work-email-state">
            <Select name="state" defaultValue={state}>
              <option value="">Failed and stuck</option>
              <option value="failed">Failed</option>
              <option value="stuck">Stuck</option>
            </Select>
          </Field>
        )}
        <Button type="submit">Apply filters</Button>
      </form>
      <p className="text-sm text-muted">
        For privacy, this screen shows metadata only, without message subjects,
        contents, job payloads or raw error text. Sign-in codes cannot be
        retried. Retry email deliveries from the email list.
      </p>
      <WorkItems query={query} context={context} />
    </section>
  )
}
async function WorkItems({
  query,
  context,
}: {
  query: Query
  context: Awaited<ReturnType<typeof requireAdminPageContext>>
}) {
  let content
  let nextCursor
  try {
    if (query.view === 'jobs') {
      const page = await withContext(getDatabase(), context, (tx) =>
        listFailedJobs(tx, context, query.queue, {
          cursor: query.cursor,
          limit: 20,
        }),
      )
      nextCursor = page.nextCursor
      content = page.items.map((job) => (
        <li key={job.id} data-job-id={job.id}>
          <Card className="grid gap-3">
            <h3 className="font-semibold break-all">Job {job.id}</h3>
            <p>Queue: {job.queue}</p>
            <p>
              Failed: {formatIndianDate(job.failedAt, { includeTime: true })}
            </p>
            <p>
              Retries after first attempt: {job.retries.toLocaleString('en-IN')}
            </p>
            {query.queue === 'notifications.send-email' ? (
              <p>Use the email list to retry delivery.</p>
            ) : query.queue === 'notifications.send-sms' ? (
              <p>Sign-in codes expire. Ask the person to request a new code.</p>
            ) : (
              <BackgroundRetry
                endpoint={`/api/admin/queues/${encodeURIComponent(query.queue)}/failed-jobs/${job.id}/retry`}
                label={`job ${job.id}`}
              />
            )}
          </Card>
        </li>
      ))
    } else {
      const page = await withContext(getDatabase(), context, (tx) =>
        listUndeliveredEmails(tx, context, {
          state: query.state || undefined,
          cursor: query.cursor,
          limit: 20,
        }),
      )
      nextCursor = page.nextCursor
      content = page.items.map((email) => (
        <li key={email.id} data-email-id={email.id}>
          <Card className="grid gap-3">
            <h3 className="font-semibold">Email {email.id}</h3>
            <p className="break-all">To: {email.to}</p>
            <p>
              Template: {email.template} · State: {email.state} · Attempts:{' '}
              {email.attempts.toLocaleString('en-IN')}
            </p>
            <p>
              Updated:{' '}
              {formatIndianDate(email.updatedAt, { includeTime: true })}
            </p>
            {email.template === 'otp' ? (
              <p>Sign-in codes expire. Ask the person to request a new code.</p>
            ) : (
              <BackgroundRetry
                endpoint={`/api/admin/emails/${email.id}/retry`}
                label={`email ${email.id}`}
              />
            )}
          </Card>
        </li>
      ))
    }
  } catch {
    return (
      <Notice tone="danger" title="Work list unavailable">
        <p>
          The cursor may have expired or the service may be unavailable. Refresh
          or start the current list again.
        </p>
        <LinkButton className="mt-3" href={queryFor(query)}>
          Start list again
        </LinkButton>
      </Notice>
    )
  }
  return (
    <>
      {content.length ? (
        <ul className="grid gap-4">{content}</ul>
      ) : (
        <EmptyState
          title="No matching work"
          description="There are no failed jobs or undelivered emails in this view."
        />
      )}
      <nav aria-label="Work pages" className="flex flex-wrap gap-3">
        {query.cursor ? (
          <LinkButton variant="secondary" href={queryFor(query)}>
            Newest records
          </LinkButton>
        ) : null}
        {nextCursor ? (
          <LinkButton href={queryFor(query, nextCursor)}>
            Older records
          </LinkButton>
        ) : null}
      </nav>
    </>
  )
}
