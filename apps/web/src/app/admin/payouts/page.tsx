import { listSellerBalances, ValidationError, withContext } from '@ecokart/core'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { EarningsRefresh } from '@/components/seller/earnings-refresh'
import { LinkButton } from '@/components/ui/button'
import { Card, EmptyState, Notice } from '@/components/ui/feedback'
import { PageHeader } from '@/components/ui/page-header'
import { ContentLoading } from '@/components/ui/page-loading'
import { getDatabase } from '@/lib/db'
import { formatInr, formatStatusLabel } from '@/lib/format'
import { requireAdminPageContext } from '@/lib/page-auth'

export const metadata: Metadata = {
  title: 'Seller balances',
  robots: { index: false },
}
export const instant = false

export default function PayoutsPage(props: PageProps<'/admin/payouts'>) {
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Seller balances"
        description="Non-zero balances, largest first. Positive means EcoKart owes the seller; negative means the seller owes EcoKart."
        actions={<EarningsRefresh label="Refresh balances" />}
      />
      <Suspense fallback={<ContentLoading />}>
        <Balances {...props} />
      </Suspense>
    </div>
  )
}

async function Balances({ searchParams }: PageProps<'/admin/payouts'>) {
  const context = await requireAdminPageContext('/admin/payouts')
  const query = await searchParams
  const cursor = Array.isArray(query.cursor)
    ? query.cursor.at(-1)
    : query.cursor
  let page
  try {
    page = await withContext(getDatabase(), context, (tx) =>
      listSellerBalances(tx, context, { cursor, limit: 20 }),
    )
  } catch (cause) {
    if (!(cause instanceof ValidationError)) throw cause
    return (
      <Notice tone="danger" title="This page of balances could not be shown">
        <p>{cause.message}</p>
        <LinkButton className="mt-3" href="/admin/payouts">
          Show first balances
        </LinkButton>
      </Notice>
    )
  }
  return (
    <>
      <section aria-label="Seller balances" className="grid gap-3">
        {page.items.length ? (
          <ul className="grid gap-3">
            {page.items.map((seller) => (
              <li key={seller.sellerId} data-seller-id={seller.sellerId}>
                <Card className="grid min-w-0 gap-3">
                  <div className="flex flex-wrap justify-between gap-3">
                    <h2 className="font-semibold break-words">
                      {seller.displayName}
                    </h2>
                    <p className="font-semibold" aria-label="Seller balance">
                      {formatInr(seller.balancePaise)}
                    </p>
                  </div>
                  <p className="text-sm text-muted">
                    {formatStatusLabel(seller.status)}
                  </p>
                  <p>
                    {seller.bankAccount
                      ? `Bank account: •••• ${seller.bankAccount.accountNumberLast4} · ${seller.bankAccount.ifsc}`
                      : 'No bank account yet'}
                  </p>
                  <div>
                    <LinkButton
                      href={{
                        pathname: `/admin/sellers/${seller.sellerId}`,
                        query: cursor ? { balanceCursor: cursor } : {},
                      }}
                      variant="secondary"
                    >
                      View seller money
                    </LinkButton>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title={cursor ? 'No more balances' : 'No balances to settle'}
            description="Sellers with a zero balance are omitted. Their details and ledger remain available from Sellers."
          />
        )}
      </section>
      <nav aria-label="Balance pages" className="flex flex-wrap gap-3">
        {cursor ? (
          <LinkButton href="/admin/payouts" variant="secondary">
            Show first balances
          </LinkButton>
        ) : null}
        {page.nextCursor ? (
          <LinkButton
            href={{
              pathname: '/admin/payouts',
              query: { cursor: page.nextCursor },
            }}
          >
            More balances
          </LinkButton>
        ) : null}
      </nav>
    </>
  )
}
