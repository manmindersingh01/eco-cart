import {
  listOwnStatements,
  ValidationError,
  withContext,
  type RequestContext,
} from '@ecokart/core'
import { StatementRequest } from './statement-request'
import { StatementStatus } from './statement-status'
import { LinkButton } from '@/components/ui/button'
import { EmptyState, Notice } from '@/components/ui/feedback'
import { getDatabase } from '@/lib/db'

export async function StatementsSection({
  context,
  cursor,
  ledgerCursor,
}: {
  context: Extract<RequestContext, { role: 'seller' }>
  cursor?: string
  ledgerCursor?: string
}) {
  let page
  try {
    page = await withContext(getDatabase(), context, (tx) =>
      listOwnStatements(tx, context, { cursor, limit: 20 }),
    )
  } catch (cause) {
    if (!(cause instanceof ValidationError)) throw cause
    return (
      <Notice tone="danger" title="Statement history could not be shown">
        <p>{cause.message}</p>
        <LinkButton
          href={{
            pathname: '/seller/earnings',
            query: ledgerCursor ? { cursor: ledgerCursor } : {},
          }}
          variant="secondary"
          className="mt-3"
        >
          Show latest statements
        </LinkButton>
      </Notice>
    )
  }
  return (
    <section
      id="settlement-statements"
      aria-labelledby="statements-heading"
      className="grid min-w-0 gap-4"
    >
      <h2 id="statements-heading" className="text-lg font-semibold">
        Settlement statements
      </h2>
      <StatementRequest visibleIds={page.items.map((item) => item.id)} />
      <h3 className="font-semibold">Statement history</h3>
      {page.items.length ? (
        <ul className="grid gap-3">
          {page.items.map((item) => (
            <li key={item.id}>
              <StatementStatus
                key={`${item.id}-${item.status}`}
                initial={item}
              />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title={cursor ? 'No more statements' : 'No statements yet'}
          description="Request a statement above to download your money history as a CSV file."
        />
      )}
      <nav aria-label="Statement pages" className="flex flex-wrap gap-3">
        {cursor ? (
          <LinkButton
            href={{
              pathname: '/seller/earnings',
              query: ledgerCursor ? { cursor: ledgerCursor } : {},
            }}
            variant="secondary"
          >
            Show latest statements
          </LinkButton>
        ) : null}
        {page.nextCursor ? (
          <LinkButton
            href={{
              pathname: '/seller/earnings',
              query: {
                statementCursor: page.nextCursor,
                ...(ledgerCursor ? { cursor: ledgerCursor } : {}),
              },
            }}
          >
            Older statements
          </LinkButton>
        ) : null}
      </nav>
    </section>
  )
}
