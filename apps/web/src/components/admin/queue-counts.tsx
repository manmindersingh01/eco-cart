import { listJobQueues } from '@ecokart/core'
import { Card, Notice } from '@/components/ui/feedback'
import { LinkButton } from '@/components/ui/button'
import { getJobQueue } from '@/lib/queue'
import { requireAdminPageContext } from '@/lib/page-auth'
export async function QueueCounts() {
  const context = await requireAdminPageContext('/admin/background-work')
  let queues
  try {
    queues = await listJobQueues(context, await getJobQueue())
  } catch {
    return (
      <Notice tone="danger" title="Queue counts unavailable">
        Refresh to try again. The lists below are loaded separately.
      </Notice>
    )
  }
  return (
    <section aria-label="Queue counts" className="grid gap-3">
      <h2 className="text-xl font-semibold">Queue counts</h2>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {queues.map((queue) => (
          <li key={queue.name}>
            <Card className="grid gap-2">
              <h3 className="font-semibold break-all">{queue.name}</h3>
              <p className="text-sm">
                Waiting {queue.waiting.toLocaleString('en-IN')} · Deferred{' '}
                {queue.deferred.toLocaleString('en-IN')} · Running{' '}
                {queue.running.toLocaleString('en-IN')} · Failed{' '}
                {queue.failed.toLocaleString('en-IN')}
              </p>
              <LinkButton
                variant="secondary"
                href={{
                  pathname: '/admin/background-work',
                  query: { view: 'jobs', queue: queue.name },
                }}
              >
                View failures in {queue.name}
              </LinkButton>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  )
}
