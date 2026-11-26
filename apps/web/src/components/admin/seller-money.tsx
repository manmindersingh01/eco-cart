import {
  getSellerBankAccount,
  getSellerLedger,
  ValidationError,
  withContext,
  type RequestContext,
} from '@ecokart/core'
import { BankAccountForm } from './bank-account-form'
import { EarningsRefresh } from '@/components/seller/earnings-refresh'
import { LinkButton } from '@/components/ui/button'
import { Card, EmptyState, Notice } from '@/components/ui/feedback'
import { getDatabase } from '@/lib/db'
import { formatIndianDate, formatInr, formatStatusLabel } from '@/lib/format'

export async function SellerMoney({
  sellerId,
  context,
  cursor,
  balanceCursor,
}: {
  sellerId: string
  context: RequestContext
  cursor?: string
  balanceCursor?: string
}) {
  const pathname = `/admin/sellers/${sellerId}` as const
  const baseQuery = balanceCursor ? { balanceCursor } : {}
  const bank = await withContext(getDatabase(), context, (tx) =>
    getSellerBankAccount(tx, context, sellerId),
  )
  let ledger
  try {
    ledger = await withContext(getDatabase(), context, (tx) =>
      getSellerLedger(tx, context, sellerId, { cursor, limit: 20 }),
    )
  } catch (cause) {
    if (!(cause instanceof ValidationError)) throw cause
    return (
      <Notice
        tone="danger"
        title="This page of money history could not be shown"
      >
        <p>{cause.message}</p>
        <LinkButton className="mt-3" href={{ pathname, query: baseQuery }}>
          Show latest money entries
        </LinkButton>
      </Notice>
    )
  }
  return (
    <section
      aria-labelledby="seller-money-heading"
      className="grid min-w-0 gap-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="seller-money-heading" className="text-xl font-semibold">
          Seller money
        </h2>
        <div className="flex flex-wrap gap-3">
          <EarningsRefresh label="Refresh seller money" />
          <LinkButton
            href={{
              pathname: '/admin/payouts',
              query: balanceCursor ? { cursor: balanceCursor } : {},
            }}
            variant="secondary"
          >
            Back to balances
          </LinkButton>
        </div>
      </div>
      <Card className="grid gap-3">
        <h3 className="font-semibold">Current balance</h3>
        <output
          aria-label="Current balance"
          className="text-3xl font-semibold break-words"
        >
          {formatInr(ledger.balancePaise)}
        </output>
        <p>
          {ledger.balancePaise < 0
            ? 'The seller owes EcoKart.'
            : ledger.balancePaise > 0
              ? 'EcoKart owes the seller.'
              : 'Nothing is owed by either side.'}{' '}
          The balance includes all entries, across every page.
        </p>
      </Card>
      <Card className="grid min-w-0 gap-5 lg:grid-cols-2">
        <div className="grid content-start gap-3">
          <h3 className="font-semibold">Saved bank account</h3>
          {bank ? (
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="text-muted">Account holder</dt>
                <dd className="break-words">{bank.accountHolder}</dd>
              </div>
              <div>
                <dt className="text-muted">Account number</dt>
                <dd>•••• {bank.accountNumberLast4}</dd>
              </div>
              <div>
                <dt className="text-muted">IFSC</dt>
                <dd className="font-mono break-all">{bank.ifsc}</dd>
              </div>
              <div>
                <dt className="text-muted">Last updated</dt>
                <dd>
                  {formatIndianDate(bank.updatedAt, { includeTime: true })}
                </dd>
              </div>
            </dl>
          ) : (
            <Notice tone="warning">
              No bank account yet. Add verified bank details before a payout is
              recorded.
            </Notice>
          )}
        </div>
        <BankAccountForm
          key={sellerId}
          sellerId={sellerId}
          last4={bank?.accountNumberLast4}
        />
      </Card>
      <section aria-labelledby="admin-ledger-heading" className="grid gap-3">
        <h3 id="admin-ledger-heading" className="text-lg font-semibold">
          Money history
        </h3>
        <p className="text-sm text-muted">
          Newest first. Positive entries add to what EcoKart owes; negative
          entries reduce it. Entries cannot be edited or deleted.
        </p>
        {ledger.items.length ? (
          <ul className="grid gap-3">
            {ledger.items.map((entry) => (
              <li key={entry.id}>
                <Card className="grid min-w-0 gap-3">
                  <div className="flex flex-wrap justify-between gap-3">
                    <h4 className="font-semibold">
                      {formatStatusLabel(entry.entryType)}
                    </h4>
                    <p className="font-semibold">
                      {entry.amountPaise > 0 ? '+' : ''}
                      {formatInr(entry.amountPaise)}
                    </p>
                  </div>
                  <p className="text-sm text-muted">
                    {formatIndianDate(entry.createdAt, { includeTime: true })}
                  </p>
                  <p className="whitespace-pre-wrap break-words">
                    {entry.description}
                  </p>
                  {entry.reference ? (
                    <p className="text-sm break-all">
                      Transfer reference: {entry.reference}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-3">
                    {entry.orderId ? (
                      <LinkButton
                        href={`/admin/orders/${entry.orderId}`}
                        variant="secondary"
                      >
                        View order
                      </LinkButton>
                    ) : null}
                    {entry.returnRequestId ? (
                      <LinkButton
                        href={`/admin/returns/${entry.returnRequestId}`}
                        variant="secondary"
                      >
                        View return
                      </LinkButton>
                    ) : null}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title={cursor ? 'No more money entries' : 'No money entries yet'}
            description="Sales, commission, refunds, payouts and adjustments appear here."
          />
        )}
        <nav aria-label="Ledger pages" className="flex flex-wrap gap-3">
          {cursor ? (
            <LinkButton
              href={{ pathname, query: baseQuery }}
              variant="secondary"
            >
              Show latest money entries
            </LinkButton>
          ) : null}
          {ledger.nextCursor ? (
            <LinkButton
              href={{
                pathname,
                query: { ...baseQuery, ledgerCursor: ledger.nextCursor },
              }}
            >
              Older money entries
            </LinkButton>
          ) : null}
        </nav>
      </section>
    </section>
  )
}
