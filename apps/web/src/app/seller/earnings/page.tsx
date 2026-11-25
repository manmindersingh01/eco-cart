import {
  getOwnLedger,
  getOwnBankAccount,
  ValidationError,
  withContext,
} from '@ecokart/core'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { EarningsRefresh } from '@/components/seller/earnings-refresh'
import { LinkButton } from '@/components/ui/button'
import { Card, EmptyState, Notice } from '@/components/ui/feedback'
import { PageHeader } from '@/components/ui/page-header'
import { ContentLoading } from '@/components/ui/page-loading'
import { getDatabase } from '@/lib/db'
import { formatIndianDate, formatInr, formatStatusLabel } from '@/lib/format'
import { requireSellerPageContext } from '@/lib/page-auth'

export const metadata: Metadata = {
  title: 'Seller earnings',
  robots: { index: false },
}
export const instant = false
export default function EarningsPage(props: PageProps<'/seller/earnings'>) {
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Earnings"
        description="Your current balance, money history and bank account for payouts."
        actions={<EarningsRefresh />}
      />
      <Suspense fallback={<ContentLoading />}>
        <Earnings {...props} />
      </Suspense>
    </div>
  )
}

async function Earnings({ searchParams }: PageProps<'/seller/earnings'>) {
  const context = await requireSellerPageContext('/seller/earnings')
  const raw = (await searchParams).cursor
  const cursor = Array.isArray(raw) ? raw.at(-1) : raw
  let result
  try {
    result = await withContext(getDatabase(), context, async (tx) => ({
      ledger: await getOwnLedger(tx, context, { cursor, limit: 20 }),
      bank: await getOwnBankAccount(tx, context),
    }))
  } catch (cause) {
    if (!(cause instanceof ValidationError)) throw cause
    return (
      <Notice tone="danger" title="This page of earnings could not be shown">
        <p>{cause.message}</p>
        <LinkButton
          href="/seller/earnings"
          variant="secondary"
          className="mt-3"
        >
          Show the latest entries
        </LinkButton>
      </Notice>
    )
  }
  const { ledger, bank } = result
  return (
    <>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Card className="grid min-w-0 gap-3">
          <h2 className="text-lg font-semibold">Current balance</h2>
          <output
            aria-label="Current balance"
            className="text-3xl font-semibold break-words"
          >
            {formatInr(ledger.balancePaise)}
          </output>
          <p>
            {ledger.balancePaise < 0
              ? 'You owe EcoKart. A negative balance can follow refunds or adjustments.'
              : ledger.balancePaise > 0
                ? 'EcoKart owes you this amount.'
                : 'Nothing is owed by either side at present.'}
          </p>
          <p className="text-sm text-muted">
            This is the balance across all entries, including payouts and
            refunds. It is not just the total on this page.
          </p>
        </Card>
        <Card className="grid min-w-0 gap-3">
          <h2 className="text-lg font-semibold">Bank account for payouts</h2>
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
            <p>No bank account has been added yet.</p>
          )}
          <p className="text-sm text-muted">
            An administrator manages these details. Contact support if they need
            to be added or corrected.
          </p>
        </Card>
      </div>
      <section aria-labelledby="ledger-heading" className="grid gap-3">
        <h2 id="ledger-heading" className="text-lg font-semibold">
          Money history
        </h2>
        <p className="text-sm text-muted">
          Positive entries add to what EcoKart owes you. Negative entries reduce
          it, including money already paid out.
        </p>
        {ledger.items.length ? (
          <ul className="grid gap-3">
            {ledger.items.map((entry) => (
              <li key={entry.id}>
                <Card className="grid min-w-0 gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">
                        {formatStatusLabel(entry.entryType)}
                      </h3>
                      <p className="text-sm text-muted">
                        {formatIndianDate(entry.createdAt, {
                          includeTime: true,
                        })}
                      </p>
                    </div>
                    <p className="font-semibold break-words">
                      {entry.amountPaise > 0 ? '+' : ''}
                      {formatInr(entry.amountPaise)}
                    </p>
                  </div>
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
                        href={`/seller/orders/${entry.orderId}`}
                        variant="secondary"
                      >
                        View order
                      </LinkButton>
                    ) : null}
                    {entry.returnRequestId ? (
                      <LinkButton
                        href={`/seller/returns/${entry.returnRequestId}`}
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
            title={cursor ? 'No more entries' : 'No money entries yet'}
            description={
              cursor
                ? 'You have reached the end of your money history.'
                : 'Sales, commission, refunds, payouts and adjustments will appear here.'
            }
          />
        )}
        <nav aria-label="Ledger pages" className="flex flex-wrap gap-3">
          {cursor ? (
            <LinkButton href="/seller/earnings" variant="secondary">
              Show the latest entries
            </LinkButton>
          ) : null}
          {ledger.nextCursor ? (
            <LinkButton
              href={`/seller/earnings?${new URLSearchParams({ cursor: ledger.nextCursor })}`}
            >
              Older entries
            </LinkButton>
          ) : null}
        </nav>
      </section>
    </>
  )
}
