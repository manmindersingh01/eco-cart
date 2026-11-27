import {
  listSellerStatements,
  ValidationError,
  withContext,
  type RequestContext,
} from '@ecokart/core'
import { StatementRequest } from '@/components/seller/statement-request'
import { StatementStatus } from '@/components/seller/statement-status'
import { LinkButton } from '@/components/ui/button'
import { EmptyState, Notice } from '@/components/ui/feedback'
import { getDatabase } from '@/lib/db'

export async function SellerStatements({
  context,
  sellerId,
  cursor,
  ledgerCursor,
  balanceCursor,
}: {
  context: RequestContext
  sellerId: string
  cursor?: string
  ledgerCursor?: string
  balanceCursor?: string
}) {
  const pathname = `/admin/sellers/${sellerId}` as const
  const query = {
    ...(ledgerCursor ? { ledgerCursor } : {}),
    ...(balanceCursor ? { balanceCursor } : {}),
  }
  let page
  try {
    page = await withContext(getDatabase(), context, (tx) =>
      listSellerStatements(tx, context, sellerId, { cursor, limit: 20 }),
    )
  } catch (cause) {
    if (!(cause instanceof ValidationError)) throw cause
    return (
      <Notice tone="danger" title="Statement history could not be shown">
        <p>{cause.message}</p>
        <LinkButton
          href={{ pathname, query }}
          className="mt-3"
          variant="secondary"
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
      <h3 id="statements-heading" className="text-lg font-semibold">
        Settlement statements
      </h3>
      <StatementRequest
        key={sellerId}
        sellerId={sellerId}
        visibleIds={page.items.map((item) => item.id)}
      />
      <h4 className="font-semibold">Statement history</h4>
      {page.items.length ? (
        <ul className="grid gap-3">
          {page.items.map((item) => (
            <li key={item.id}>
              <StatementStatus
                key={`${item.id}-${item.status}`}
                initial={item}
                area="admin"
              />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title={cursor ? 'No more statements' : 'No statements yet'}
          description="Request a statement above to download this seller’s money history as a CSV file."
        />
      )}
      <nav aria-label="Statement pages" className="flex flex-wrap gap-3">
        {cursor ? (
          <LinkButton href={{ pathname, query }} variant="secondary">
            Show latest statements
          </LinkButton>
        ) : null}
        {page.nextCursor ? (
          <LinkButton
            href={{
              pathname,
              query: { ...query, statementCursor: page.nextCursor },
            }}
          >
            Older statements
          </LinkButton>
        ) : null}
      </nav>
    </section>
  )
}
